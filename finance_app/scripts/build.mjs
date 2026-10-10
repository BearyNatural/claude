// Builds the three parts of the desktop app:
//   dist/main/index.js      Electron main process (Node, CommonJS bundle)
//   dist/preload/index.js   Preload bridge (sandboxed, CommonJS bundle)
//   dist/renderer/          React UI (Vite)
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { copyFileSync, rmSync } from 'node:fs';

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
  define: {
    'process.env.GERANIUM_DEV': JSON.stringify(dev ? '1' : ''),
    // Optional built-in Google "Desktop app" OAuth client (CI passes it from repository secrets).
    // Google treats a desktop client's secret as not confidential; without these the app asks
    // for a client in Reports › Google Sheets instead.
    ...(process.env.GERANIUM_GOOGLE_DESKTOP_CLIENT_ID ? {
      'process.env.GERANIUM_GOOGLE_CLIENT_ID': JSON.stringify(process.env.GERANIUM_GOOGLE_DESKTOP_CLIENT_ID),
      'process.env.GERANIUM_GOOGLE_CLIENT_SECRET': JSON.stringify(process.env.GERANIUM_GOOGLE_DESKTOP_CLIENT_SECRET ?? ''),
    } : {}),
  },
};

await esbuild({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  // Runtime dependencies stay in node_modules (they ship wasm/worker files).
  external: ['electron', 'sql.js', 'pdfjs-dist', 'xlsx'],
});
// The window icon (Linux task bars use it when they cannot match the window to its desktop entry).
copyFileSync('build/window-icon.png', 'dist/main/window-icon.png');

await esbuild({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
  external: ['electron'],
});

await viteBuild({ configFile: 'vite.config.ts', logLevel: 'warn' });
console.log(`Built Geranium (${dev ? 'development' : 'production'})`);
