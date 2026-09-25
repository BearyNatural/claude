/**
 * Plant photos in the browser version: kept in this browser's own storage
 * (IndexedDB), never uploaded. Loaded into memory when the app opens so the
 * rest of the app can use them like files on a phone. Photos are shrunk the
 * same way as on the phone (about 1600 px, 70% JPEG).
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { newId } from '../../domain/ids';
import type { PhotoFiles } from './photoFiles';

const DB = 'sow-by-season-photos';
const STORE = 'photos';
const MAX_EDGE = 1600;

const files = new Map<string, string>(); // file name → base64 JPEG
let loaded: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    fn(t.objectStore(STORE));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

function persist(file: string, base64: string | null) {
  void tx('readwrite', (s) => (base64 === null ? s.delete(file) : s.put(base64, file))).catch(() => undefined);
}

async function blobToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const devicePhotoFiles: PhotoFiles = {
  ready() {
    loaded ??= (async () => {
      if (typeof indexedDB === 'undefined') return;
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          files.set(String(c.key), String(c.value));
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
      db.close();
    })().catch(() => undefined);
    return loaded;
  },
  async importImage(sourceUri, size) {
    const long = size ? Math.max(size.width, size.height) : undefined;
    const resize = long && long > MAX_EDGE ? [{ resize: size!.width >= size!.height ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
    const out = await manipulateAsync(sourceUri, resize, { compress: 0.7, format: SaveFormat.JPEG, base64: true });
    const b64 = out.base64 ?? (await blobToBase64(out.uri));
    const name = `${newId('ph')}.jpg`;
    files.set(name, b64);
    persist(name, b64);
    return name;
  },
  uri: (file) => `data:image/jpeg;base64,${files.get(file) ?? ''}`,
  exists: (file) => files.has(file),
  list: () => [...files.keys()],
  remove(file) {
    files.delete(file);
    persist(file, null);
  },
  removeAll() {
    for (const f of [...files.keys()]) this.remove(f);
  },
  readBase64: async (file) => files.get(file) ?? '',
  writeBase64(file, base64) {
    files.set(file, base64);
    persist(file, base64);
  },
};
