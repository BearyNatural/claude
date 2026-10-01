import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DecryptError, ScryptParams, deriveKey, newScryptParams, open, randomKey, seal, wipe } from './crypto';

/**
 * Protects the database encryption key (DEK). The DEK itself never leaves memory unencrypted.
 *
 * Two protection modes:
 *  - "os": the DEK is encrypted by the operating system's credential store
 *    (macOS Keychain, Windows DPAPI, Linux Secret Service/KWallet) via Electron safeStorage.
 *    Anyone who can log in as this user can open the app.
 *  - "password": the DEK is encrypted with a key derived from the user's password or PIN
 *    (scrypt). The app cannot be opened without it — and if it is forgotten, the data cannot
 *    be recovered. There is no back door.
 *
 * Optionally, a recovery key (a random 24-character code shown to the user once) also wraps the
 * DEK, so a forgotten password can be replaced. It is the user's to keep; nothing is sent anywhere.
 */

export interface OsProtector {
  available(): boolean;
  /** e.g. "keychain", "dpapi", "gnome_libsecret", "kwallet", or "basic_text" (weak). */
  backend(): string;
  encrypt(plain: Buffer): Buffer;
  decrypt(wrapped: Buffer): Buffer;
}

export type LockKind = 'password' | 'pin';

interface KeyFile {
  version: 1;
  protection: 'os' | 'password';
  os?: { wrapped: string; backend: string };
  password?: { kind: LockKind; kdf: ScryptParams; wrapped: string };
  recovery?: { kdf: ScryptParams; wrapped: string; createdAt: string };
  createdAt: string;
  updatedAt: string;
}

// Format identifier from the app's first name (Paperbark). Never change it: existing keystores depend on it.
const AAD = Buffer.from('paperbark-dek-v1');
const RECOVERY_AAD = Buffer.from('geranium-recovery-v1');

/** Crockford base32: no I, L, O or U, so a key read aloud or written down is hard to mistype. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CHARS = 24; // 120 random bits

/** A new recovery key, e.g. "K7QD-9XWM-3TFA-PZ2R-HC8N-5VJB". */
export function newRecoveryKey(): string {
  const bytes = randomBytes((RECOVERY_CHARS * 5) / 8);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Accepts the key with or without dashes or spaces, in any case, and with O/I/L for 0/1. */
export function normaliseRecoveryKey(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== RECOVERY_CHARS || [...s].some((c) => !RECOVERY_ALPHABET.includes(c))) {
    throw new RecoveryKeyFormatError();
  }
  return s;
}

export class RecoveryKeyFormatError extends Error {
  constructor() {
    super('That isn’t a recovery key. It has 24 letters and numbers, usually written in six groups of four.');
    this.name = 'RecoveryKeyFormatError';
  }
}

export interface ProtectionStatus {
  exists: boolean;
  protection: 'os' | 'password' | null;
  lockKind: LockKind | null;
  osBackend: string | null;
  /** 'weak' when the only protection is an OS store that just obfuscates (Linux without a keyring). */
  strength: 'strong' | 'weak' | null;
  /** When the current recovery key was made, or null if there is none. */
  recoveryCreatedAt: string | null;
}

export class KeyStore {
  constructor(private readonly file: string, private readonly os: OsProtector, private readonly scryptN = 2 ** 17) {}

  exists(): boolean {
    return existsSync(this.file);
  }

  private read(): KeyFile {
    const kf = JSON.parse(readFileSync(this.file, 'utf8')) as KeyFile;
    if (kf.version !== 1) throw new Error('Unsupported key file version');
    return kf;
  }

  private write(kf: KeyFile): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(kf, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  status(): ProtectionStatus {
    if (!this.exists()) return { exists: false, protection: null, lockKind: null, osBackend: this.os.available() ? this.os.backend() : null, strength: null, recoveryCreatedAt: null };
    const kf = this.read();
    const weakOs = kf.protection === 'os' && (kf.os?.backend === 'basic_text' || kf.os?.backend === 'unavailable');
    return {
      exists: true,
      protection: kf.protection,
      lockKind: kf.password?.kind ?? null,
      osBackend: kf.os?.backend ?? null,
      strength: weakOs ? 'weak' : 'strong',
      recoveryCreatedAt: kf.recovery?.createdAt ?? null,
    };
  }

  /** Create a new DEK protected by the OS store (or by a password when one is given). */
  async create(password?: { secret: string; kind: LockKind }): Promise<Buffer> {
    const dek = randomKey();
    const now = new Date().toISOString();
    if (password) {
      const kdf = newScryptParams(this.scryptN);
      const kek = await deriveKey(password.secret, kdf);
      this.write({ version: 1, protection: 'password', password: { kind: password.kind, kdf, wrapped: seal(kek, dek, AAD).toString('base64') }, createdAt: now, updatedAt: now });
      wipe(kek);
    } else {
      if (!this.os.available()) throw new Error('No operating-system credential store is available. Set an app password to protect your data.');
      this.write({ version: 1, protection: 'os', os: { wrapped: this.os.encrypt(dek).toString('base64'), backend: this.os.backend() }, createdAt: now, updatedAt: now });
    }
    return dek;
  }

  unlockWithOs(): Buffer {
    const kf = this.read();
    if (kf.protection !== 'os' || !kf.os) throw new Error('This data is protected by a password.');
    try {
      return this.os.decrypt(Buffer.from(kf.os.wrapped, 'base64'));
    } catch {
      throw new DecryptError('The operating system could not unlock the encryption key. If you moved to a new computer or user account, restore from an encrypted backup instead.');
    }
  }

  async unlockWithPassword(secret: string): Promise<Buffer> {
    const kf = this.read();
    if (kf.protection !== 'password' || !kf.password) throw new Error('This data is not protected by a password.');
    const kek = await deriveKey(secret, kf.password.kdf);
    try {
      return open(kek, Buffer.from(kf.password.wrapped, 'base64'), AAD);
    } catch {
      throw new DecryptError('Incorrect password.');
    } finally {
      wipe(kek);
    }
  }

  /** Protect the (already unlocked) DEK with a password or PIN instead of the OS store. */
  async setPassword(dek: Buffer, secret: string, kind: LockKind): Promise<void> {
    const kf = this.exists() ? this.read() : null;
    const kdf = newScryptParams(this.scryptN);
    const kek = await deriveKey(secret, kdf);
    const now = new Date().toISOString();
    this.write({ version: 1, protection: 'password', password: { kind, kdf, wrapped: seal(kek, dek, AAD).toString('base64') }, recovery: kf?.recovery, createdAt: kf?.createdAt ?? now, updatedAt: now });
    wipe(kek);
  }

  /** Go back to OS-store protection (no password needed to open the app). */
  removePassword(dek: Buffer): void {
    if (!this.os.available()) throw new Error('No operating-system credential store is available, so the password cannot be removed.');
    const kf = this.read();
    const now = new Date().toISOString();
    this.write({ version: 1, protection: 'os', os: { wrapped: this.os.encrypt(dek).toString('base64'), backend: this.os.backend() }, recovery: kf.recovery, createdAt: kf.createdAt, updatedAt: now });
  }

  /** Wrap the (already unlocked) DEK with a recovery key. Replaces any earlier recovery key. */
  async setRecovery(dek: Buffer, recoveryKey: string): Promise<string> {
    const kf = this.read();
    const kdf = newScryptParams(this.scryptN);
    const kek = await deriveKey(normaliseRecoveryKey(recoveryKey), kdf);
    const now = new Date().toISOString();
    try {
      this.write({ ...kf, recovery: { kdf, wrapped: seal(kek, dek, RECOVERY_AAD).toString('base64'), createdAt: now }, updatedAt: now });
    } finally {
      wipe(kek);
    }
    return now;
  }

  removeRecovery(): void {
    const { recovery: _old, ...rest } = this.read();
    void _old;
    this.write({ ...rest, updatedAt: new Date().toISOString() });
  }

  async unlockWithRecovery(recoveryKey: string): Promise<Buffer> {
    const kf = this.read();
    if (!kf.recovery) throw new Error('No recovery key has been set up for this data.');
    const kek = await deriveKey(normaliseRecoveryKey(recoveryKey), kf.recovery.kdf);
    try {
      return open(kek, Buffer.from(kf.recovery.wrapped, 'base64'), RECOVERY_AAD);
    } catch {
      throw new DecryptError('That recovery key doesn’t match this data. Check each group of four characters.');
    } finally {
      wipe(kek);
    }
  }
}

/** A protector for tests and for environments without an OS store (reports itself as unavailable). */
export function unavailableProtector(): OsProtector {
  return {
    available: () => false,
    backend: () => 'unavailable',
    encrypt: () => { throw new Error('unavailable'); },
    decrypt: () => { throw new Error('unavailable'); },
  };
}
