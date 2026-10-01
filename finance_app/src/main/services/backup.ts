import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DecryptError, ScryptParams, deriveKey, newScryptParams, open, seal, sha256, wipe } from '../crypto/crypto';
import { AppDatabase } from '../db/database';
import { SCHEMA_VERSION, currentVersion } from '../db/schema';
import { DocumentStore } from './documents';

/**
 * Encrypted backups. A backup is one file the user saves wherever they like (local disk,
 * USB drive, NAS, or a Dropbox/OneDrive/Google Drive/iCloud folder). Geranium never uploads it.
 *
 * Layout: "PBBACKUP" | version (1 byte) | header length (4 bytes) | header JSON | encrypted payload
 *  - header: scrypt parameters and salt, creation date, schema version, and a small encrypted
 *    "check" value so a wrong password can be told apart from a damaged file.
 *  - payload: AES-256-GCM encryption of a zip containing the database and documents.
 * The password is never stored. If it is lost, the backup cannot be opened.
 */

const MAGIC = Buffer.from('PBBACKUP');
const VERSION = 1;
// Format identifier from the app's first name (Paperbark). Never change it: existing backups depend on it.
const CHECK_TEXT = Buffer.from('paperbark-backup-check-v1');

interface BackupHeader {
  kdf: ScryptParams;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  check: string;
}

export interface BackupManifest {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  documents: { id: string; fileName: string; sha256: string }[];
}

export class BackupPasswordError extends Error {
  constructor() {
    super('Incorrect password for this backup.');
    this.name = 'BackupPasswordError';
  }
}

export class BackupDamagedError extends Error {
  constructor(detail = 'This backup file is damaged or incomplete and cannot be restored.') {
    super(detail);
    this.name = 'BackupDamagedError';
  }
}

function counts(db: AppDatabase): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['accounts', 'transactions', 'categories', 'rules', 'budgets', 'bills', 'goals', 'payslips', 'documents', 'trades', 'super_entries']) {
    out[t] = db.scalar<number>(`SELECT COUNT(*) FROM ${t}`) ?? 0;
  }
  return out;
}

export async function createBackup(db: AppDatabase, docs: DocumentStore | null, password: string, appVersion: string, scryptN = 2 ** 17): Promise<{ bytes: Buffer; manifest: BackupManifest }> {
  if (password.length < 8) throw new Error('Use a backup password of at least 8 characters.');
  const docRows = db.all<{ id: string; file_name: string; sha256: string }>('SELECT id, file_name, sha256 FROM documents');
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    appVersion,
    schemaVersion: currentVersion(db),
    counts: counts(db),
    documents: docRows.map((d) => ({ id: d.id, fileName: d.file_name, sha256: d.sha256 })),
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'database.sqlite': db.export(),
  };
  if (docs) for (const d of docRows) files[`documents/${d.id}`] = docs.get(d.id);
  const zip = zipSync(files, { level: 6 });
  const kdf = newScryptParams(scryptN);
  const key = await deriveKey(password, kdf);
  try {
    const header: BackupHeader = { kdf, createdAt: manifest.createdAt, appVersion, schemaVersion: manifest.schemaVersion, check: seal(key, CHECK_TEXT, Buffer.from('check')).toString('base64') };
    const headerBytes = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(headerBytes.length);
    const prefix = Buffer.concat([MAGIC, Buffer.from([VERSION]), len, headerBytes]);
    return { bytes: Buffer.concat([prefix, seal(key, zip, prefix)]), manifest };
  } finally {
    wipe(key);
  }
}

function parse(file: Uint8Array): { header: BackupHeader; prefix: Buffer; payload: Buffer } {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < 13 || !buf.subarray(0, 8).equals(MAGIC)) throw new BackupDamagedError('This is not a Geranium backup file.');
  if (buf[8] !== VERSION) throw new BackupDamagedError('This backup was made by a newer version of Geranium.');
  const len = buf.readUInt32BE(9);
  if (13 + len > buf.length) throw new BackupDamagedError();
  let header: BackupHeader;
  try {
    header = JSON.parse(buf.subarray(13, 13 + len).toString('utf8')) as BackupHeader;
  } catch {
    throw new BackupDamagedError();
  }
  return { header, prefix: buf.subarray(0, 13 + len), payload: buf.subarray(13 + len) };
}

/** Decrypt and validate a backup without changing anything. */
export async function openBackup(file: Uint8Array, password: string): Promise<{ manifest: BackupManifest; database: Uint8Array; documents: Map<string, Uint8Array> }> {
  const { header, prefix, payload } = parse(file);
  const key = await deriveKey(password, header.kdf);
  try {
    try {
      open(key, Buffer.from(header.check, 'base64'), Buffer.from('check'));
    } catch {
      throw new BackupPasswordError();
    }
    let zip: Buffer;
    try {
      zip = open(key, payload, prefix);
    } catch (e) {
      if (e instanceof DecryptError) throw new BackupDamagedError();
      throw e;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(zip);
    } catch {
      throw new BackupDamagedError();
    }
    if (!entries['manifest.json'] || !entries['database.sqlite']) throw new BackupDamagedError();
    const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest;
    if (manifest.schemaVersion > SCHEMA_VERSION) throw new BackupDamagedError('This backup was made by a newer version of Geranium. Update Geranium to restore it.');
    const documents = new Map<string, Uint8Array>();
    for (const d of manifest.documents) {
      const bytes = entries[`documents/${d.id}`];
      if (!bytes || sha256(bytes) !== d.sha256) throw new BackupDamagedError(`The document "${d.fileName}" in this backup is damaged.`);
      documents.set(d.id, bytes);
    }
    // Make sure the database itself opens.
    const check = await AppDatabase.openMemory(entries['database.sqlite']);
    try {
      currentVersion(check);
    } catch {
      throw new BackupDamagedError();
    } finally {
      check.close();
    }
    return { manifest, database: entries['database.sqlite'], documents };
  } finally {
    wipe(key);
  }
}

export function backupInfo(file: Uint8Array): { createdAt: string; appVersion: string; schemaVersion: number } {
  const { header } = parse(file);
  return { createdAt: header.createdAt, appVersion: header.appVersion, schemaVersion: header.schemaVersion };
}
