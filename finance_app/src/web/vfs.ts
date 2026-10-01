/**
 * The browser build's file system: the app's data folder held in memory and kept in the
 * browser's IndexedDB. Everything written here is already encrypted by the app (the database,
 * key store and documents), exactly as on the desktop — IndexedDB only ever sees ciphertext and
 * the wrapped key.
 *
 * Reads and writes are synchronous (the app's storage code expects Node's `fs`); every change is
 * also queued, in order, to IndexedDB. `flush()` waits for the queue.
 */

const DB_NAME = 'geranium';
const STORE = 'files';

function norm(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

export class VirtualFs {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['/']);
  private db: IDBDatabase | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** The last storage failure (for example the browser's storage quota), if any. */
  lastError: string | null = null;
  onError: ((message: string) => void) | null = null;

  /** Load everything from IndexedDB. With `indexedDB` unavailable the files live in memory only. */
  async load(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
    if (!idb) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entries = await new Promise<[string, Uint8Array][]>((resolve, reject) => {
      const out: [string, Uint8Array][] = [];
      const req = this.db!.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        out.push([String(cur.key), new Uint8Array(cur.value as ArrayBuffer)]);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    for (const [path, data] of entries) {
      this.files.set(path, data);
      this.addDirs(parentOf(path));
    }
  }

  exists(path: string): boolean {
    const p = norm(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  read(path: string): Uint8Array | undefined {
    return this.files.get(norm(path));
  }

  write(path: string, data: Uint8Array): void {
    const p = norm(path);
    const copy = data.slice();
    this.files.set(p, copy);
    this.addDirs(parentOf(p));
    this.persist((s) => s.put(copy.buffer, p));
  }

  rename(from: string, to: string): void {
    const a = norm(from), b = norm(to);
    const data = this.files.get(a);
    if (!data) throw enoent(from);
    this.files.delete(a);
    this.files.set(b, data);
    this.addDirs(parentOf(b));
    this.persist((s) => {
      s.put(data.buffer, b);
      s.delete(a);
    });
  }

  remove(path: string, recursive = false): void {
    const p = norm(path);
    if (this.files.delete(p)) {
      this.persist((s) => s.delete(p));
      return;
    }
    if (!this.dirs.has(p)) return;
    if (!recursive && this.list(p).length) throw Object.assign(new Error(`ENOTEMPTY: ${path}`), { code: 'ENOTEMPTY' });
    const prefix = p === '/' ? '/' : `${p}/`;
    const gone = [...this.files.keys()].filter((k) => k.startsWith(prefix));
    for (const k of gone) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(prefix)) this.dirs.delete(d);
    this.dirs.add('/');
    if (gone.length) this.persist((s) => gone.forEach((k) => s.delete(k)));
  }

  mkdir(path: string): void {
    this.addDirs(norm(path));
  }

  /** Names directly inside a folder. */
  list(path: string): string[] {
    const p = norm(path);
    const prefix = p === '/' ? '/' : `${p}/`;
    const names = new Set<string>();
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (k !== p && k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  }

  /** Resolves when every change so far has reached IndexedDB. */
  flush(): Promise<void> {
    return this.queue;
  }

  private addDirs(path: string): void {
    let p = path;
    while (!this.dirs.has(p)) {
      this.dirs.add(p);
      p = parentOf(p);
    }
  }

  private persist(op: (store: IDBObjectStore) => void): void {
    const db = this.db;
    if (!db) return;
    this.queue = this.queue.then(
      () =>
        new Promise<void>((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          op(tx.objectStore(STORE));
          tx.oncomplete = () => resolve();
          const fail = () => {
            this.lastError = tx.error?.message ?? 'The browser could not save the data.';
            this.onError?.(this.lastError);
            resolve();
          };
          tx.onerror = fail;
          tx.onabort = fail;
        }),
    );
  }
}

export function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
}

/** The one file system the browser build uses. */
export const vfs = new VirtualFs();
