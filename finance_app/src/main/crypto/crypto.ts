import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Cryptography used by Paperbark. Only established primitives from Node's crypto module:
 *  - AES-256-GCM (authenticated encryption) for the database, attachments and backups
 *  - scrypt for deriving keys from passwords
 * No custom algorithms.
 */

export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptError extends Error {
  constructor(message = 'The data could not be decrypted. The key or password may be wrong, or the file may be damaged.') {
    super(message);
    this.name = 'DecryptError';
  }
}

export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Encrypt: output is [12-byte IV][16-byte tag][ciphertext]. `aad` is authenticated but not encrypted. */
export function seal(key: Buffer, plaintext: Uint8Array, aad?: Uint8Array): Buffer {
  if (key.length !== KEY_BYTES) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function open(key: Buffer, sealed: Uint8Array, aad?: Uint8Array): Buffer {
  if (key.length !== KEY_BYTES) throw new DecryptError('Encryption key must be 32 bytes');
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  if (buf.length < IV_BYTES + TAG_BYTES) throw new DecryptError('The encrypted data is too short — the file may be damaged.');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  try {
    // An explicit tag length stops a shortened tag from being accepted.
    const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    if (aad) d.setAAD(aad);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new DecryptError();
  }
}

export interface ScryptParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string; // base64
}

/** Interactive-login strength: N=2^17, r=8, p=1 (~128 MiB, a fraction of a second). */
export function newScryptParams(N = 2 ** 17): ScryptParams {
  return { name: 'scrypt', N, r: 8, p: 1, salt: randomBytes(16).toString('base64') };
}

export function deriveKey(password: string, params: ScryptParams): Promise<Buffer> {
  if (params.name !== 'scrypt') return Promise.reject(new Error('Unsupported key derivation'));
  const maxmem = 128 * params.N * params.r + 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), Buffer.from(params.salt, 'base64'), KEY_BYTES, { N: params.N, r: params.r, p: params.p, maxmem }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Overwrite a key in memory when it is no longer needed (best effort in a garbage-collected runtime). */
export function wipe(buf: Buffer | null | undefined): void {
  if (buf) buf.fill(0);
}
