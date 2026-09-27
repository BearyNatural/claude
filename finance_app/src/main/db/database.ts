import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from 'sql.js';
import { open as decrypt, seal } from '../crypto/crypto';

/**
 * The local database: SQLite (compiled to WebAssembly via sql.js) held in memory and saved
 * to disk as a single AES-256-GCM encrypted file. The plaintext database never touches disk.
 *
 * Saves are atomic (write to a temp file, fsync, rename) and the previous version is kept as
 * "<file>.prev" so a crash mid-save cannot lose data.
 */

const MAGIC = Buffer.from('PBDB');
const FORMAT_VERSION = 1;
const HEADER = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION])]);

let sqlPromise: Promise<SqlJsStatic> | null = null;

// The bundled main process is CommonJS (has `require`); tests run as ES modules.
const nodeRequire: NodeRequire = typeof require === 'function' ? require : createRequire(`${process.cwd()}/`);

function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // Read the WebAssembly binary directly so it works inside packaged apps as well as tests.
    const wasmPath = nodeRequire.resolve('sql.js/dist/sql-wasm.wasm');
    const wasm = readFileSync(wasmPath);
    sqlPromise = initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  }
  return sqlPromise;
}

export type Row = Record<string, SqlValue>;
export type Params = SqlValue[] | Record<string, SqlValue>;

export function encryptDatabase(bytes: Uint8Array, key: Buffer): Buffer {
  return Buffer.concat([HEADER, seal(key, bytes, HEADER)]);
}

export function decryptDatabase(file: Uint8Array, key: Buffer): Uint8Array {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < HEADER.length || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('This is not a Paperbark database file.');
  if (buf[4] !== FORMAT_VERSION) throw new Error('This database was written by a newer version of Paperbark.');
  return decrypt(key, buf.subarray(HEADER.length), HEADER);
}

export class AppDatabase {
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private inTx = 0;

  private constructor(private db: SqlJsDatabase, private readonly file: string | null, private key: Buffer | null) {
    this.applyPragmas();
  }

  static async openEncrypted(file: string, key: Buffer): Promise<AppDatabase> {
    const SQL = await loadSql();
    let bytes: Uint8Array | undefined;
    if (existsSync(file)) {
      try {
        bytes = decryptDatabase(readFileSync(file), key);
      } catch (e) {
        // Fall back to the previous good copy if the main file is damaged.
        if (existsSync(`${file}.prev`)) bytes = decryptDatabase(readFileSync(`${file}.prev`), key);
        else throw e;
      }
    }
    return new AppDatabase(new SQL.Database(bytes), file, Buffer.from(key));
  }

  static async openMemory(bytes?: Uint8Array): Promise<AppDatabase> {
    const SQL = await loadSql();
    return new AppDatabase(new SQL.Database(bytes), null, null);
  }

  private applyPragmas() {
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  run(sql: string, params?: Params): void {
    this.db.run(sql, params as never);
    this.markDirty();
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.markDirty();
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(params as never);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar<T extends SqlValue = SqlValue>(sql: string, params?: Params): T | undefined {
    const row = this.get<Row>(sql, params);
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  /** Run several statements atomically. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.inTx > 0) return fn();
    this.db.run('BEGIN');
    this.inTx++;
    try {
      const r = fn();
      this.db.run('COMMIT');
      return r;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      this.inTx--;
      this.markDirty();
    }
  }

  private markDirty() {
    this.dirty = true;
    if (!this.file || this.inTx > 0) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  export(): Uint8Array {
    const bytes = this.db.export();
    this.applyPragmas(); // export() resets connection settings
    return bytes;
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.file || !this.key || !this.dirty) return;
    const enc = encryptDatabase(this.export(), this.key);
    const tmp = `${this.file}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, enc);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.prev`);
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** Write everything, then drop the database and key from memory. */
  close(): void {
    this.saveNow();
    this.db.close();
    if (this.key) this.key.fill(0);
    this.key = null;
  }

  get path(): string | null {
    return this.file;
  }
}
