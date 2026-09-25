// Finishes the browser build after `expo export --platform web` so it can be
// installed from the browser ("Add to Home Screen" on iPhone and Android) and
// opened offline:
//   - web app manifest + icons
//   - iPhone home-screen tags
//   - a small service worker: the page itself is always fetched fresh when
//     online (so updates arrive on the next open); app files are cached so it
//     still opens offline. Garden data lives in the browser, not in this cache.
// Run: node scripts/prepare-web.mjs <dist-dir> <base-path e.g. /sow-by-season>
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dist = 'dist', basePath = '/sow-by-season'] = process.argv.slice(2);
const base = basePath.replace(/\/$/, '');
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const theme = '#2F6B3F';
const background = '#F6F4EE';

for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) copyFileSync(new URL(`../web/${f}`, import.meta.url), join(dist, f));

writeFileSync(
  join(dist, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: app.name,
      short_name: app.name,
      description: 'Know what to plant, and when — an Australian garden planner. Your garden stays on your device.',
      start_url: `${base}/`,
      scope: `${base}/`,
      display: 'standalone',
      background_color: background,
      theme_color: theme,
      icons: [
        { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ),
);

// Every built file except the page itself, for the offline cache.
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const assets = walk(dist)
  .map((f) => `${base}/${relative(dist, f).split('\\').join('/')}`)
  .filter((u) => !u.endsWith('/index.html') && !u.endsWith('/sw.js'));
const version = `${app.version}-${Date.now().toString(36)}`;

writeFileSync(
  join(dist, 'sw.js'),
  `// Sow by Season offline cache (${version}). Garden data is not stored here.
const CACHE = 'sow-by-season-${version}';
const PAGE = '${base}/';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([PAGE, ...ASSETS])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sow-by-season-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Newest page when online; the cached copy when offline.
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(PAGE, copy)); return res; }).catch(() => caches.match(PAGE)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`,
);

const head = `
    <link rel="manifest" href="${base}/manifest.webmanifest" />
    <meta name="theme-color" content="${theme}" />
    <link rel="apple-touch-icon" href="${base}/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${app.name}" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="description" content="Know what to plant, and when — an Australian garden planner. Your garden stays on your device." />
    <script>if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('${base}/sw.js', { scope: '${base}/' }).catch(() => {}));</script>
`;
const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf8');
if (!html.includes('manifest.webmanifest')) html = html.replace('</head>', `${head}</head>`);
writeFileSync(indexPath, html);
console.log(`Prepared ${dist} for ${base}/ (${assets.length} cached files, version ${version}).`);
