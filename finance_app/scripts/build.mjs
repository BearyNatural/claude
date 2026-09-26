// Builds the three parts of the desktop app:
//   dist/main/index.js      Electron main process (Node, CommonJS bundle)
//   dist/preload/index.js   Preload bridge (sandboxed, CommonJS bundle)
//   dist/renderer/          React UI (Vite)
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync } from 'node:fs';

const dev = process.argv.includes('--dev');
rmSync('dist/main', { recursive: true, force: true });
rmSync('dist/preload', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'warning',
  define: { 'process.env.PAPERBARK_DEV': JSON.stringify(dev ? '1' : '') },
};

await esbuild({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  // Runtime dependencies stay in node_modules (they ship wasm/worker files).
  external: ['electron', 'sql.js', 'pdfjs-dist', 'xlsx'],
});

await esbuild({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
  external: ['electron'],
});

await viteBuild({ configFile: 'vite.config.ts', logLevel: 'warn' });
console.log(`Built Paperbark (${dev ? 'development' : 'production'})`);
