import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDatabase, encryptDatabase } from '../db/database';
import { migrate, currentVersion, SCHEMA_VERSION } from '../db/schema';
import { KeyStore, LockKind, OsProtector } from '../crypto/keyStore';
import { randomKey, wipe } from '../crypto/crypto';
import { Ctx, makeCtx, seedDefaults, updateSettings, getSettings } from '../services/core';
import { DocumentStore } from '../services/documents';
import { createBackup, openBackup, backupInfo } from '../services/backup';
import { seedDemo } from '../demo/demoData';

/**
 * Holds the unlocked database, document store and key for the running app, and performs
 * every step that needs the raw key (unlock, lock, password change, backup, restore).
 * While locked, none of the financial data is in memory.
 */

export interface AppStatus {
  initialised: boolean;
  unlocked: boolean;
  demo: boolean;
  protection: 'os' | 'password' | null;
  lockKind: LockKind | null;
  osBackend: string | null;
  strength: 'strong' | 'weak' | null;
  osStoreAvailable: boolean;
  dataFolder: string;
  schemaVersion: number;
}

export class AppState {
  private db: AppDatabase | null = null;
  private dek: Buffer | null = null;
  private docs: DocumentStore | null = null;
  ctx: Ctx | null = null;
  demo = false;
  private failedAttempts = 0;
  private lockedUntil = 0;
  readonly keyStore: KeyStore;

  constructor(readonly dataDir: string, private readonly os: OsProtector, readonly appVersion: string, private readonly onChanged: (area: string) => void = () => undefined, scryptN = 2 ** 17) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    // The app was first released as Paperbark: carry its database file name over.
    for (const suffix of ['', '.prev']) {
      const legacy = join(dataDir, `paperbark.pbdb${suffix}`);
      const current = join(dataDir, `geranium.db${suffix}`);
      if (existsSync(legacy) && !existsSync(current)) renameSync(legacy, current);
    }
    this.keyStore = new KeyStore(join(dataDir, 'keystore.json'), os, scryptN);
  }

  get dbFile(): string {
    return join(this.dataDir, 'geranium.db');
  }

  status(): AppStatus {
    const s = this.keyStore.status();
    return {
      initialised: s.exists,
      unlocked: !!this.ctx,
      demo: this.demo,
      protection: s.protection,
      lockKind: s.lockKind,
      osBackend: s.osBackend,
      strength: s.strength,
      osStoreAvailable: this.os.available(),
      dataFolder: this.dataDir,
      schemaVersion: this.db ? currentVersion(this.db) : SCHEMA_VERSION,
    };
  }

  requireCtx(): Ctx {
    if (!this.ctx) throw new Error('LOCKED');
    return this.ctx;
  }

  requireDocs(): DocumentStore {
    if (!this.docs) throw new Error('LOCKED');
    return this.docs;
  }

  private async openWith(dek: Buffer): Promise<void> {
    const existed = existsSync(this.dbFile);
    const db = await AppDatabase.openEncrypted(this.dbFile, dek);
    migrate(db, (from) => {
      // Keep an encrypted copy of the database from before the upgrade.
      if (existed) copyFileSync(this.dbFile, join(this.dataDir, `pre-migration-v${from}-${new Date().toISOString().slice(0, 10)}.db`));
    });
    this.db = db;
    this.dek = dek;
    this.docs = new DocumentStore(join(this.dataDir, 'documents'), dek);
    this.ctx = makeCtx(db, { changed: this.onChanged });
    seedDefaults(this.ctx);
    db.saveNow();
  }

  /** First run: create the key and an empty encrypted database. */
  async initialise(password?: { secret: string; kind: LockKind }): Promise<void> {
    if (this.keyStore.exists()) throw new Error('Geranium has already been set up on this computer.');
    if (password) validateSecret(password.secret, password.kind);
    const dek = await this.keyStore.create(password);
    await this.openWith(dek);
  }

  async unlock(secret?: string): Promise<void> {
    if (this.ctx) return;
    if (Date.now() < this.lockedUntil) throw new Error(`Too many attempts. Try again in ${Math.ceil((this.lockedUntil - Date.now()) / 1000)} seconds.`);
    const st = this.keyStore.status();
    try {
      const dek = st.protection === 'password' ? await this.keyStore.unlockWithPassword(secret ?? '') : this.keyStore.unlockWithOs();
      this.failedAttempts = 0;
      await this.openWith(dek);
    } catch (e) {
      if (st.protection === 'password') {
        this.failedAttempts++;
        // Slow down repeated guesses: 5 free attempts, then growing delays.
        if (this.failedAttempts >= 5) this.lockedUntil = Date.now() + Math.min(300, 2 ** (this.failedAttempts - 4) * 5) * 1000;
      }
      throw e;
    }
  }

  /** Save, then remove the data and key from memory. */
  lock(): void {
    if (this.demo) {
      this.exitDemo();
      return;
    }
    if (this.db) this.db.close();
    this.docs?.lock();
    wipe(this.dek);
    this.db = null;
    this.dek = null;
    this.docs = null;
    this.ctx = null;
  }

  canLock(): boolean {
    return this.keyStore.status().protection === 'password';
  }

  async setPassword(secret: string, kind: LockKind): Promise<void> {
    if (!this.dek || this.demo) throw new Error('Unlock Geranium first.');
    validateSecret(secret, kind);
    await this.keyStore.setPassword(this.dek, secret, kind);
  }

  async removePassword(currentSecret: string): Promise<void> {
    if (!this.dek || this.demo) throw new Error('Unlock Geranium first.');
    await this.keyStore.unlockWithPassword(currentSecret);
    this.keyStore.removePassword(this.dek);
  }

  /* ------------------------------ demo mode ------------------------------ */

  /** Demo data lives only in memory, in a separate database. The real database is locked first. */
  async enterDemo(): Promise<void> {
    if (this.demo) return;
    if (this.ctx) this.lock();
    const db = await AppDatabase.openMemory();
    migrate(db);
    this.db = db;
    this.dek = randomKey();
    this.docs = null;
    this.ctx = makeCtx(db, { isDemo: true, changed: this.onChanged });
    seedDefaults(this.ctx);
    seedDemo(this.ctx);
    this.demo = true;
  }

  exitDemo(): void {
    if (!this.demo) return;
    this.db?.close();
    wipe(this.dek);
    this.db = null;
    this.dek = null;
    this.ctx = null;
    this.demo = false;
  }

  /* ------------------------------ backup & restore ------------------------------ */

  async backupTo(password: string): Promise<{ bytes: Buffer; counts: Record<string, number> }> {
    if (!this.db || this.demo) throw new Error('Unlock your own data (not demo mode) to make a backup.');
    this.db.saveNow();
    const { bytes, manifest } = await createBackup(this.db, this.docs, password, this.appVersion);
    updateSettings(this.requireCtx(), { lastBackupAt: new Date().toISOString() });
    return { bytes, counts: manifest.counts };
  }

  inspectBackup(file: Uint8Array) {
    return backupInfo(file);
  }

  /**
   * Replace the current data with a backup. An encrypted copy of the current database is kept
   * first ("pre-restore-….db"). Older backups are migrated to the current schema.
   */
  async restoreFrom(file: Uint8Array, password: string): Promise<{ counts: Record<string, number>; preRestoreCopy: string | null }> {
    if (!this.dek || this.demo) throw new Error('Unlock Geranium (not demo mode) before restoring.');
    const restored = await openBackup(file, password);
    const dek = Buffer.from(this.dek);
    let copy: string | null = null;
    if (existsSync(this.dbFile)) {
      this.db?.saveNow();
      copy = join(this.dataDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      copyFileSync(this.dbFile, copy);
    }
    const oldDocs = this.docs?.ids() ?? [];
    this.lock();
    writeFileSync(this.dbFile, encryptDatabase(restored.database, dek), { mode: 0o600 });
    await this.openWith(dek);
    const docs = this.requireDocs();
    for (const id of oldDocs) if (!restored.documents.has(id)) docs.remove(id);
    for (const [id, bytes] of restored.documents) docs.put(id, bytes);
    this.onChanged('all');
    return { counts: restored.manifest.counts, preRestoreCopy: copy };
  }

  /** Used by tests and the restore flow to read the raw encrypted file. */
  readDbFile(): Buffer {
    return readFileSync(this.dbFile);
  }

  settings() {
    return getSettings(this.requireCtx());
  }
}

export function validateSecret(secret: string, kind: LockKind): void {
  if (kind === 'pin') {
    if (!/^\d{6,12}$/.test(secret)) throw new Error('A PIN must be 6 to 12 digits.');
  } else if (secret.length < 8) {
    throw new Error('Use a password of at least 8 characters.');
  }
}
