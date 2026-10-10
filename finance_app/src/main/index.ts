import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, protocol, safeStorage, session, shell } from 'electron';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm',
};
import { AppState } from './app/state';
import { OsProtector } from './crypto/keyStore';
import { Platform, buildRegistry, dispatch } from './api';
import { dueReminders, markRemindersSent } from './services/reminders';
import { getSettings } from './services/core';
import { localToday } from '../domain/dates';
import { runSelfTest } from './selfTest';

const DEV = process.env.GERANIUM_DEV === '1';
const APP_ORIGIN = 'app://geranium';
/** Sites the app may open in the user's own browser (source links, Google consent). */
const EXTERNAL_ALLOWED = [/^https:\/\/(www\.)?ato\.gov\.au\//, /^https:\/\/(www\.)?treasury\.gov\.au\//, /^https:\/\/(www\.)?legislation\.gov\.au\//, /^https:\/\/accounts\.google\.com\//, /^https:\/\/docs\.google\.com\//, /^https:\/\/console\.cloud\.google\.com\//, /^mailto:\?subject=/];

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }]);

/** `--self-test`: verify a packaged build loads its runtime pieces, print the result and exit. */
const SELF_TEST = process.argv.includes('--self-test');
if (SELF_TEST) app.setPath('userData', mkdtempSync(join(tmpdir(), 'geranium-selftest-')));

// Only one copy of the app may use the data folder at a time.
if (!SELF_TEST && !app.requestSingleInstanceLock()) app.quit();
app.enableSandbox();
app.setAppUserModelId('au.bearynatural.geranium');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const osProtector: OsProtector = {
  available: () => safeStorage.isEncryptionAvailable(),
  backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'keychain' : 'dpapi'),
  encrypt: (b) => safeStorage.encryptString(b.toString('base64')),
  decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'base64'),
};

let win: BrowserWindow | null = null;
let state: AppState;
let lastActivity = Date.now();
let unlockedAt = 0;
const openedTemp: string[] = [];

function send(channel: string, payload?: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let changeTimer: NodeJS.Timeout | null = null;
const changedAreas = new Set<string>();
function onChanged(area: string) {
  changedAreas.add(area);
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    send('data:changed', [...changedAreas]);
    changedAreas.clear();
    changeTimer = null;
  }, 50);
}

function cleanTemp() {
  while (openedTemp.length) rmSync(openedTemp.pop()!, { recursive: true, force: true });
}

function doLock(reason: string) {
  if (!state.ctx || state.demo || !state.canLock()) return;
  state.lock();
  cleanTemp();
  send('app:locked', reason);
}

const platform: Platform = {
  async openFile(opts) {
    const r = await dialog.showOpenDialog(win!, { title: opts.title, filters: opts.filters, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: basename(r.filePaths[0]), bytes: new Uint8Array(readFileSync(r.filePaths[0])) };
  },
  async saveFile(opts, content) {
    const r = await dialog.showSaveDialog(win!, { title: opts.title, defaultPath: opts.defaultName, filters: opts.filters });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, content);
    return r.filePath;
  },
  async chooseFolder(title) {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  },
  async writeFiles(folder, files) {
    const root = resolve(folder);
    for (const f of files) {
      const target = resolve(root, normalize(f.path));
      if (!target.startsWith(root + sep)) throw new Error('Invalid file name in export');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
  },
  async openPath(p) {
    await shell.openPath(p);
  },
  async openExternal(url) {
    if (!EXTERNAL_ALLOWED.some((re) => re.test(url))) throw new Error('That link is not on the list of sites Geranium can open.');
    await shell.openExternal(url);
  },
  async openDocument(fileName, bytes) {
    // A decrypted copy is needed for another program to show it. It lives in a private temporary
    // folder and is deleted when Geranium locks or quits.
    const dir = mkdtempSync(join(tmpdir(), 'geranium-open-'));
    openedTemp.push(dir);
    const file = join(dir, basename(fileName).replace(/[\\/:*?"<>|]/g, '_'));
    writeFileSync(file, bytes, { mode: 0o600 });
    await shell.openPath(file);
  },
};

function createWindow() {
  win = new BrowserWindow({
    width: AUTOSHOT ? 1440 : 1360,
    height: AUTOSHOT ? 960 : 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'Geranium',
    backgroundColor: '#f6f3ec',
    show: false,
    // Linux panels show this when they cannot match the window to the installed desktop entry.
    ...(process.platform === 'linux' ? { icon: join(__dirname, 'window-icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: DEV,
      navigateOnDragDrop: false,
    },
  });
  win.once('ready-to-show', () => { if (!AUTOSHOT) win?.show(); });
  win.on('minimize', () => {
    if (state.ctx && getSettings(state.ctx).autoLock.enabled && getSettings(state.ctx).autoLock.onMinimise) doLock('minimised');
  });
  win.loadURL(`${APP_ORIGIN}/index.html`);
}

function hardenSessions() {
  const ses = session.defaultSession;
  ses.setSpellCheckerEnabled(false);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // The UI never loads anything from the network.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith(`${APP_ORIGIN}/`) || details.url.startsWith('devtools://') || details.url.startsWith('data:');
    cb({ cancel: !ok });
  });
  ses.protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'geranium') return new Response('Not found', { status: 404 });
    const root = resolve(__dirname, '../renderer');
    const target = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    let body: Buffer;
    try {
      body = await readFile(target);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
    });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    e.preventDefault();
    // "Email it to myself": a draft with no recipient, opened in the user's own email app.
    if (/^mailto:\?subject=/.test(url)) void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_ALLOWED.some((re) => re.test(url))) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

function menu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [{ label: 'Lock Geranium', accelerator: 'CmdOrCtrl+L', click: () => doLock('menu') }, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(DEV ? [{ role: 'toggleDevTools' as const }] : [])] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function timers() {
  // Auto-lock checks.
  setInterval(() => {
    if (!state.ctx || state.demo) return;
    const a = getSettings(state.ctx).autoLock;
    if (!a.enabled) return;
    if (Date.now() - lastActivity > a.idleMinutes * 60_000) doLock('idle');
    else if (a.maxSessionMinutes && Date.now() - unlockedAt > a.maxSessionMinutes * 60_000) doLock('time-limit');
  }, 15_000).unref();
  powerMonitor.on('suspend', () => state.ctx && getSettings(state.ctx).autoLock.enabled && getSettings(state.ctx).autoLock.onSleep && doLock('sleep'));
  powerMonitor.on('lock-screen', () => state.ctx && getSettings(state.ctx).autoLock.enabled && getSettings(state.ctx).autoLock.onSleep && doLock('screen-locked'));
  // Local reminders (only while unlocked, never in demo mode).
  const check = () => {
    if (!state.ctx || state.demo || !Notification.isSupported()) return;
    const now = new Date();
    const due = dueReminders(state.ctx, { date: localToday(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` });
    for (const r of due.slice(0, 5)) {
      const n = new Notification({ title: r.title, body: r.body, silent: false });
      n.on('click', () => {
        win?.show();
        win?.focus();
        send('navigate', r.route);
      });
      n.show();
    }
    markRemindersSent(state.ctx, due.map((r) => r.key));
  };
  setInterval(check, 5 * 60_000).unref();
  setTimeout(check, 20_000).unref();
}

/**
 * Development-only visual check: runs hidden with a throwaway data folder and demo data,
 * and saves a screenshot of each screen. Not present in production builds.
 */
const AUTOSHOT = DEV ? process.env.GERANIUM_AUTOSHOT ?? '' : '';
if (AUTOSHOT) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'geranium-autoshot-')));
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

async function runAutoShots(dir: string) {
  const routes = (process.env.GERANIUM_AUTOSHOT_ROUTES ?? 'dashboard').split(',');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  mkdirSync(dir, { recursive: true });
  await state.enterDemo();
  win!.webContents.reload();
  await wait(4000);
  for (const r of routes) {
    const [route, theme] = r.split(':');
    if (theme) win!.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    send('navigate', route);
    await wait(3000);
    const img = await win!.webContents.capturePage();
    writeFileSync(join(dir, `${route}${theme ? `-${theme}` : ''}.png`), img.toPNG());
  }
  app.quit();
}

app.whenReady().then(async () => {
  if (SELF_TEST) {
    // A watchdog so a self-test can never leave a hung process behind.
    setTimeout(() => app.exit(2), 180_000);
    let ok = false;
    try {
      const r = await runSelfTest();
      ok = r.ok;
      const report = `Geranium ${app.getVersion()} self-test\n${r.lines.join('\n')}\n${r.ok ? 'PASSED' : 'FAILED'}\n`;
      process.stdout.write(report);
      // Windows GUI apps have no console, so CI can ask for the report in a file too.
      if (process.env.GERANIUM_SELF_TEST_OUT) writeFileSync(process.env.GERANIUM_SELF_TEST_OUT, report);
    } catch (e) {
      process.stdout.write(`Geranium self-test crashed: ${e instanceof Error ? e.message : String(e)}\nFAILED\n`);
    } finally {
      // Windows keeps Chromium's files in this temporary folder open until exit, so removal can
      // fail there; the folder is in the OS temp directory and is left for the OS to clean up.
      try { rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { /* see above */ }
      app.exit(ok ? 0 : 1);
    }
    return;
  }
  const dataDir = join(app.getPath('userData'), 'vault');
  // The app was first released as Paperbark: bring that data folder across once.
  const legacyDir = join(app.getPath('appData'), 'Paperbark', 'vault');
  if (!existsSync(join(dataDir, 'keystore.json')) && existsSync(join(legacyDir, 'keystore.json'))) {
    cpSync(legacyDir, dataDir, { recursive: true, errorOnExist: false, force: false });
  }
  state = new AppState(dataDir, osProtector, app.getVersion(), onChanged);
  const registry = buildRegistry({ state, platform });
  hardenSessions();
  menu();
  ipcMain.handle('api', async (event, method: unknown, input: unknown) => {
    // Only our own UI may call the API.
    if (!event.senderFrame || !event.senderFrame.url.startsWith(`${APP_ORIGIN}/`)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed.' } };
    if (typeof method !== 'string') return { ok: false, error: { code: 'INVALID', message: 'Invalid request.' } };
    const wasUnlocked = !!state.ctx;
    const res = await dispatch(registry, state, method, input);
    if (!wasUnlocked && state.ctx) {
      unlockedAt = Date.now();
      lastActivity = Date.now();
    }
    return res;
  });
  ipcMain.on('activity', () => {
    lastActivity = Date.now();
  });
  createWindow();
  timers();
  if (AUTOSHOT) win!.webContents.once('did-finish-load', () => void runAutoShots(AUTOSHOT));
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try {
    if (state?.ctx && !state.demo) state.lock();
    else state?.exitDemo();
  } finally {
    cleanTemp();
  }
});
