import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Browser build of Geranium (`npm run build:web` → dist/web), published to
 * daydreaminginthecloud.bearynatural.dev/geranium/.
 *
 * The same UI, API, services and encrypted storage as the desktop app. The parts of Node that
 * the storage code uses are replaced with browser versions (src/web/shims), and the app's
 * "main process" runs in a Web Worker (src/web/worker.ts) with its data in IndexedDB.
 */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8')) as { version: string };
// The Google "Web application" OAuth client ID is public (it is sent to Google in every sign-in URL).
const googleWebClientId = process.env.GERANIUM_GOOGLE_WEB_CLIENT_ID ?? '';

export default defineConfig({
  root: here('./src/web'),
  base: './',
  publicDir: here('./web-public'),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'process.env.GERANIUM_GOOGLE_CLIENT_ID': JSON.stringify(googleWebClientId),
    'process.env.GERANIUM_GOOGLE_CLIENT_SECRET': 'undefined',
  },
  resolve: {
    alias: [
      { find: '@domain', replacement: here('./src/domain') },
      { find: '@shared', replacement: here('./src/shared') },
      { find: /^node:crypto$/, replacement: here('./src/web/shims/crypto.ts') },
      { find: /^node:fs$/, replacement: here('./src/web/shims/fs.ts') },
      { find: /^node:path$/, replacement: here('./src/web/shims/path.ts') },
      { find: /^node:module$/, replacement: here('./src/web/shims/module.ts') },
      // Desktop sign-in uses a local web server; the browser uses a pop-up instead.
      { find: /^\.\/google\/oauth$/, replacement: here('./src/web/googleAuth.ts') },
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: here('./dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    target: ['firefox115', 'chrome115', 'safari16.4', 'edge115'],
    chunkSizeWarningLimit: 4000,
  },
});
