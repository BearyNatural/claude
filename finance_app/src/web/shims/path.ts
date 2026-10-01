/** The subset of Node's `path` module the app uses (POSIX paths only), for the browser build. */

export const sep = '/';

export function normalize(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const b = normalize(p).split('/').pop() ?? '';
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

export function resolve(...parts: string[]): string {
  return normalize(parts.reduce((acc, p) => (p.startsWith('/') ? p : `${acc}/${p}`), '/'));
}

export default { sep, normalize, join, dirname, basename, extname, resolve };
