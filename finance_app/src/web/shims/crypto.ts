import { Buffer } from 'buffer';
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The subset of Node's `crypto` module the app uses, for the browser build: AES-256-GCM and
 * scrypt from the audited @noble libraries, randomness from the browser's crypto.getRandomValues.
 * Swapped in for `node:crypto` by the web build. Output is byte-for-byte the same as Node's, so
 * backups made on the desktop open in the browser and the other way round (see the tests).
 */

const TAG_BYTES = 16;
const view = (b: Uint8Array) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const asBuffer = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function randomBytes(size: number): Buffer {
  const b = Buffer.alloc(size);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

class AesGcm {
  private chunks: Uint8Array[] = [];
  private aad: Uint8Array | undefined;
  private tag: Uint8Array | undefined;
  private outTag: Buffer | undefined;
  private done = false;

  constructor(private readonly decrypting: boolean, algorithm: string, private readonly key: Uint8Array, private readonly iv: Uint8Array, opts?: { authTagLength?: number }) {
    if (algorithm !== 'aes-256-gcm') throw new Error(`Unsupported cipher: ${algorithm}`);
    if (key.length !== 32) throw new Error('Invalid key length');
    if ((opts?.authTagLength ?? TAG_BYTES) !== TAG_BYTES) throw new Error('Only 16-byte authentication tags are supported');
  }

  setAAD(aad: Uint8Array): this {
    this.aad = view(aad).slice();
    return this;
  }

  setAuthTag(tag: Uint8Array): this {
    if (tag.length !== TAG_BYTES) throw new Error('Invalid authentication tag length');
    this.tag = view(tag).slice();
    return this;
  }

  update(data: Uint8Array): Buffer {
    if (this.done) throw new Error('Cipher already finalised');
    this.chunks.push(view(data).slice());
    return Buffer.alloc(0);
  }

  final(): Buffer {
    if (this.done) throw new Error('Cipher already finalised');
    this.done = true;
    const input = concat(this.chunks);
    const cipher = gcm(view(this.key), view(this.iv), this.aad);
    if (this.decrypting) {
      if (!this.tag) throw new Error('Authentication tag missing');
      // Throws if the tag does not match (wrong key or tampered data).
      return asBuffer(cipher.decrypt(concat([input, this.tag])));
    }
    const sealed = cipher.encrypt(input);
    this.outTag = asBuffer(sealed.slice(sealed.length - TAG_BYTES));
    return asBuffer(sealed.slice(0, sealed.length - TAG_BYTES));
  }

  getAuthTag(): Buffer {
    if (!this.outTag) throw new Error('Authentication tag not available before final()');
    return this.outTag;
  }
}

export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, opts?: { authTagLength?: number }) {
  return new AesGcm(false, algorithm, key, iv, opts);
}

export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, opts?: { authTagLength?: number }) {
  return new AesGcm(true, algorithm, key, iv, opts);
}

export function scrypt(
  password: string | Uint8Array,
  salt: Uint8Array,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem?: number },
  cb: (err: Error | null, key: Buffer) => void,
): void {
  scryptAsync(typeof password === 'string' ? password : view(password), view(salt), { N: opts.N, r: opts.r, p: opts.p, dkLen: keylen, maxmem: opts.maxmem })
    .then((key) => cb(null, asBuffer(key)))
    .catch((err: Error) => cb(err, Buffer.alloc(0)));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`);
  const h = sha256.create();
  const hash = {
    update(data: Uint8Array | string) {
      h.update(typeof data === 'string' ? new TextEncoder().encode(data) : view(data));
      return hash;
    },
    digest(encoding?: BufferEncoding) {
      const out = asBuffer(h.digest());
      return encoding ? out.toString(encoding) : out;
    },
  };
  return hash;
}
