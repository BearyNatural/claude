import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  createdAt: string;
  updatedAt: string;
}

// Format identifier from the app's first name (Paperbark). Never change it: existing keystores depend on it.
const AAD = Buffer.from('paperbark-dek-v1');

export interface ProtectionStatus {
  exists: boolean;
  protection: 'os' | 'password' | null;
  lockKind: LockKind | null;
  osBackend: string | null;
  /** 'weak' when the only protection is an OS store that just obfuscates (Linux without a keyring). */
  strength: 'strong' | 'weak' | null;
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
    if (!this.exists()) return { exists: false, protection: null, lockKind: null, osBackend: this.os.available() ? this.os.backend() : null, strength: null };
    const kf = this.read();
    const weakOs = kf.protection === 'os' && (kf.os?.backend === 'basic_text' || kf.os?.backend === 'unavailable');
    return {
      exists: true,
      protection: kf.protection,
      lockKind: kf.password?.kind ?? null,
      osBackend: kf.os?.backend ?? null,
      strength: weakOs ? 'weak' : 'strong',
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
    this.write({ version: 1, protection: 'password', password: { kind, kdf, wrapped: seal(kek, dek, AAD).toString('base64') }, createdAt: kf?.createdAt ?? now, updatedAt: now });
    wipe(kek);
  }

  /** Go back to OS-store protection (no password needed to open the app). */
  removePassword(dek: Buffer): void {
    if (!this.os.available()) throw new Error('No operating-system credential store is available, so the password cannot be removed.');
    const kf = this.read();
    const now = new Date().toISOString();
    this.write({ version: 1, protection: 'os', os: { wrapped: this.os.encrypt(dek).toString('base64'), backend: this.os.backend() }, createdAt: kf.createdAt, updatedAt: now });
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
