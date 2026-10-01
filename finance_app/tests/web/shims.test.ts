import { describe, expect, it } from 'vitest';
import * as node from 'node:crypto';
import * as web from '../../src/web/shims/crypto';
import { open, seal, DecryptError } from '@main/crypto/crypto';
import { VirtualFs } from '../../src/web/vfs';
import { join, dirname, basename, extname, normalize } from '../../src/web/shims/path';

/**
 * The browser build swaps Node's crypto, fs and path for these shims. Backups and data files
 * must stay byte-compatible between the desktop app and the website, so the crypto shim is
 * checked against Node's own implementation.
 */

const IV = 12, TAG = 16;

function webSeal(key: Buffer, plaintext: Uint8Array, aad?: Uint8Array): Buffer {
  const iv = web.randomBytes(IV);
  const c = web.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function webOpen(key: Buffer, sealed: Buffer, aad?: Uint8Array): Buffer {
  const d = web.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV), { authTagLength: TAG });
  if (aad) d.setAAD(aad);
  d.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(sealed.subarray(IV + TAG)), d.final()]);
}

describe('browser crypto shim', () => {
  const key = node.randomBytes(32);
  const aad = Buffer.from('PBDB\x01');
  const text = Buffer.from('Opening balance $2,000.00 — groceries $82.40 '.repeat(50));

  it('decrypts what the desktop app encrypts, and the other way round', () => {
    expect(webOpen(key, seal(key, text, aad), aad).equals(text)).toBe(true);
    expect(open(key, webSeal(key, text, aad), aad).equals(text)).toBe(true);
  });

  it('produces exactly the same ciphertext and tag as Node for the same IV', () => {
    const iv = node.randomBytes(IV);
    const n = node.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
    n.setAAD(aad);
    const nodeOut = Buffer.concat([n.update(text), n.final(), n.getAuthTag()]);
    const w = web.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
    w.setAAD(aad);
    const webOut = Buffer.concat([w.update(text), w.final(), w.getAuthTag()]);
    expect(webOut.equals(nodeOut)).toBe(true);
  });

  it('rejects tampering, the wrong key, the wrong associated data and short tags', () => {
    const sealed = webSeal(key, text, aad);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => webOpen(key, tampered, aad)).toThrow();
    expect(() => webOpen(node.randomBytes(32), sealed, aad)).toThrow();
    expect(() => webOpen(key, sealed, Buffer.from('other'))).toThrow();
    expect(() => web.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV), { authTagLength: 16 }).setAuthTag(sealed.subarray(IV, IV + 8))).toThrow();
    expect(() => open(key, tampered, aad)).toThrow(DecryptError);
  });

  it('derives the same scrypt keys as Node (so passwords work in both)', async () => {
    const salt = node.randomBytes(16);
    const opts = { N: 2 ** 10, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
    const viaNode = node.scryptSync('correct horse battery staple'.normalize('NFKC'), salt, 32, opts);
    const viaWeb = await new Promise<Buffer>((resolve, reject) => web.scrypt('correct horse battery staple'.normalize('NFKC'), salt, 32, opts, (err, k) => (err ? reject(err) : resolve(k))));
    expect(viaWeb.equals(viaNode)).toBe(true);
  });

  it('hashes and compares like Node', () => {
    expect(web.createHash('sha256').update(text).digest('hex')).toBe(node.createHash('sha256').update(text).digest('hex'));
    expect(web.timingSafeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(web.timingSafeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(() => web.timingSafeEqual(Buffer.from('a'), Buffer.from('ab'))).toThrow(RangeError);
    expect(web.randomBytes(16)).toHaveLength(16);
    expect(web.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('browser file system', () => {
  it('reads, writes, renames, lists and removes like the parts of fs the app uses', () => {
    const fs = new VirtualFs();
    fs.mkdir('/vault/documents');
    fs.write('/vault/geranium.db.tmp', new Uint8Array([1, 2, 3]));
    fs.rename('/vault/geranium.db.tmp', '/vault/geranium.db');
    fs.write('/vault/documents/a.bin', new Uint8Array([9]));
    expect(fs.exists('/vault/geranium.db')).toBe(true);
    expect(fs.exists('/vault/geranium.db.tmp')).toBe(false);
    expect([...fs.read('/vault/geranium.db')!]).toEqual([1, 2, 3]);
    expect(fs.list('/vault').sort()).toEqual(['documents', 'geranium.db']);
    expect(fs.list('/vault/documents')).toEqual(['a.bin']);
    expect(() => fs.remove('/vault/documents')).toThrow(/ENOTEMPTY/);
    fs.remove('/vault/documents', true);
    expect(fs.exists('/vault/documents/a.bin')).toBe(false);
    expect(() => fs.rename('/nope', '/x')).toThrow(/ENOENT/);
  });

  it('keeps its own copy of written data', () => {
    const fs = new VirtualFs();
    const data = new Uint8Array([1, 2, 3]);
    fs.write('/f', data);
    data[0] = 7;
    expect(fs.read('/f')![0]).toBe(1);
  });

  it('handles POSIX paths', () => {
    expect(join('/vault', 'documents', 'x.bin')).toBe('/vault/documents/x.bin');
    expect(join('/vault/', '../other', './y')).toBe('/other/y');
    expect(dirname('/vault/geranium.db')).toBe('/vault');
    expect(basename('/vault/geranium.db', '.db')).toBe('geranium');
    expect(extname('/a/b.tar.gz')).toBe('.gz');
    expect(normalize('a//b/../c')).toBe('a/c');
  });
});
