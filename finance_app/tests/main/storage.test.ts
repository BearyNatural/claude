import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase, decryptDatabase } from '@main/db/database';
import { migrate, SCHEMA_VERSION, currentVersion } from '@main/db/schema';
import { KeyStore, OsProtector, unavailableProtector } from '@main/crypto/keyStore';
import { DecryptError, open, randomKey, seal } from '@main/crypto/crypto';

function fakeOs(backend = 'gnome_libsecret'): OsProtector {
  const k = randomKey();
  return { available: () => true, backend: () => backend, encrypt: (b) => seal(k, b), decrypt: (b) => open(k, b) };
}

describe('encryption primitives', () => {
  it('round-trips and detects tampering or the wrong key', () => {
    const key = randomKey();
    const sealed = seal(key, Buffer.from('secret'), Buffer.from('aad'));
    expect(open(key, sealed, Buffer.from('aad')).toString()).toBe('secret');
    expect(() => open(randomKey(), sealed, Buffer.from('aad'))).toThrow(DecryptError);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => open(key, tampered, Buffer.from('aad'))).toThrow(DecryptError);
    expect(() => open(key, sealed, Buffer.from('other'))).toThrow(DecryptError);
  });
});

describe('encrypted database file', () => {
  it('never writes plaintext and survives reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-db-'));
    try {
      const file = join(dir, 'paperbark.pbdb');
      const key = randomKey();
      const db = await AppDatabase.openEncrypted(file, key);
      migrate(db);
      db.run("INSERT INTO settings(key, value) VALUES('probe', '\"WOOLWORTHS-SECRET-MARKER\"')");
      db.saveNow();
      const raw = readFileSync(file);
      expect(raw.subarray(0, 4).toString()).toBe('PBDB');
      expect(raw.includes(Buffer.from('WOOLWORTHS-SECRET-MARKER'))).toBe(false);
      expect(raw.includes(Buffer.from('SQLite format'))).toBe(false);
      db.close();
      const again = await AppDatabase.openEncrypted(file, key);
      expect(again.scalar("SELECT value FROM settings WHERE key = 'probe'")).toBe('"WOOLWORTHS-SECRET-MARKER"');
      expect(currentVersion(again)).toBe(SCHEMA_VERSION);
      again.close();
      await expect(AppDatabase.openEncrypted(file, randomKey())).rejects.toThrow(DecryptError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the previous copy if the main file is damaged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-db-'));
    try {
      const file = join(dir, 'paperbark.pbdb');
      const key = randomKey();
      const db = await AppDatabase.openEncrypted(file, key);
      migrate(db);
      db.saveNow();
      db.run("INSERT INTO settings(key, value) VALUES('a', '1')");
      db.saveNow();
      db.close();
      expect(existsSync(`${file}.prev`)).toBe(true);
      const damaged = readFileSync(file);
      damaged[40] ^= 0xff;
      writeFileSync(file, damaged);
      const reopened = await AppDatabase.openEncrypted(file, key);
      expect(currentVersion(reopened)).toBe(SCHEMA_VERSION);
      reopened.close();
      expect(() => decryptDatabase(Buffer.from('nope'), key)).toThrow(/not a Paperbark database/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a database from a newer version and runs migrations once', async () => {
    const db = await AppDatabase.openMemory();
    let called = 0;
    expect(migrate(db, () => called++)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(called).toBe(0); // new databases have nothing to back up
    expect(migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    db.run("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    expect(() => migrate(db)).toThrow(/newer than this version/);
  });
});

describe('key store', () => {
  it('protects the key with the operating system store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-ks-'));
    try {
      const os = fakeOs();
      const ks = new KeyStore(join(dir, 'keystore.json'), os, 2 ** 10);
      const dek = await ks.create();
      expect(ks.status()).toMatchObject({ exists: true, protection: 'os', strength: 'strong' });
      expect(ks.unlockWithOs().equals(dek)).toBe(true);
      expect(readFileSync(join(dir, 'keystore.json'), 'utf8')).not.toContain(dek.toString('base64'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports Linux basic_text storage as weak', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-ks-'));
    try {
      const ks = new KeyStore(join(dir, 'k.json'), fakeOs('basic_text'), 2 ** 10);
      await ks.create();
      expect(ks.status().strength).toBe('weak');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets, checks, changes and removes a password', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-ks-'));
    try {
      const ks = new KeyStore(join(dir, 'k.json'), fakeOs(), 2 ** 10);
      const dek = await ks.create();
      await ks.setPassword(dek, 'correct horse battery', 'password');
      expect(ks.status()).toMatchObject({ protection: 'password', lockKind: 'password' });
      expect(() => ks.unlockWithOs()).toThrow(/password/);
      await expect(ks.unlockWithPassword('wrong')).rejects.toThrow('Incorrect password.');
      expect((await ks.unlockWithPassword('correct horse battery')).equals(dek)).toBe(true);
      await ks.setPassword(dek, '482913', 'pin');
      expect(ks.status().lockKind).toBe('pin');
      ks.removePassword(dek);
      expect(ks.unlockWithOs().equals(dek)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires a password when there is no OS store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-ks-'));
    try {
      const ks = new KeyStore(join(dir, 'k.json'), unavailableProtector(), 2 ** 10);
      await expect(ks.create()).rejects.toThrow(/Set an app password/);
      const dek = await ks.create({ secret: 'long enough password', kind: 'password' });
      expect(dek).toHaveLength(32);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
