import { Buffer } from 'buffer';
import { enoent, vfs } from '../vfs';

/**
 * The subset of Node's `fs` module the app's storage code uses, backed by the browser's
 * IndexedDB through the virtual file system. Swapped in for `node:fs` by the web build.
 */

type Data = Uint8Array | string;
type Enc = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined;

const toBytes = (d: Data) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
const encodingOf = (e: Enc) => (typeof e === 'string' ? e : e?.encoding ?? null);

export function existsSync(path: string): boolean {
  return vfs.exists(path);
}

export function readFileSync(path: string, enc?: Enc): Buffer | string {
  const data = vfs.read(path);
  if (!data) throw enoent(path);
  const b = Buffer.from(data);
  const e = encodingOf(enc);
  return e ? b.toString(e) : b;
}

export function writeFileSync(path: string, data: Data, _opts?: unknown): void {
  vfs.write(path, toBytes(data));
}

export function renameSync(from: string, to: string): void {
  vfs.rename(from, to);
}

export function copyFileSync(from: string, to: string): void {
  const data = vfs.read(from);
  if (!data) throw enoent(from);
  vfs.write(to, data);
}

export function mkdirSync(path: string, _opts?: unknown): void {
  vfs.mkdir(path);
}

export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void {
  if (!vfs.exists(path)) {
    if (opts?.force) return;
    throw enoent(path);
  }
  vfs.remove(path, !!opts?.recursive);
}

export function readdirSync(path: string): string[] {
  return vfs.list(path);
}

// File descriptors: only "write a whole new file" is needed (atomic database saves).
const open = new Map<number, { path: string; chunks: Uint8Array[] }>();
let nextFd = 3;

export function openSync(path: string, flags: string, _mode?: number): number {
  if (flags !== 'w') throw new Error(`openSync: unsupported flags "${flags}"`);
  const fd = nextFd++;
  open.set(fd, { path, chunks: [] });
  return fd;
}

export function writeSync(fd: number, data: Data): number {
  const f = open.get(fd);
  if (!f) throw new Error('writeSync: bad file descriptor');
  const bytes = toBytes(data);
  f.chunks.push(bytes.slice());
  return bytes.length;
}

export function fsyncSync(_fd: number): void {
  // Durability comes from the IndexedDB queue (see VirtualFs.flush).
}

export function closeSync(fd: number): void {
  const f = open.get(fd);
  if (!f) return;
  open.delete(fd);
  const size = f.chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of f.chunks) {
    out.set(c, at);
    at += c.length;
  }
  vfs.write(f.path, out);
}

export default { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, rmSync, readdirSync, openSync, writeSync, fsyncSync, closeSync };
