// Must be first: the storage and crypto code expects Node's Buffer.
import './shims/buffer-global';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { zipSync } from 'fflate';
import { setSqlLoader } from '../main/db/database';
import { AppState } from '../main/app/state';
import { unavailableProtector } from '../main/crypto/keyStore';
import { Platform, buildRegistry, dispatch } from '../main/api';
import { getSettings } from '../main/services/core';
import { UserError } from '../main/services/core';
import { vfs } from './vfs';
import { setAppBase } from './googleAuth';
import type { FromWorker, PickedFile, ToWorker } from './protocol';

/**
 * Geranium in the browser: this worker plays the part of the desktop app's main process.
 * It runs the same API, services and encrypted storage, with the data folder kept in this
 * browser's IndexedDB. The page (bridge.ts) only shows the UI, picks files and saves downloads.
 */


const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

setSqlLoader(() => initSqlJs({ locateFile: () => sqlWasmUrl }));
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Links the app may open (same list as the desktop app, plus the Google sign-in page). */
const EXTERNAL_ALLOWED = [/^https:\/\/(www\.)?ato\.gov\.au\//, /^https:\/\/(www\.)?treasury\.gov\.au\//, /^https:\/\/(www\.)?legislation\.gov\.au\//, /^https:\/\/accounts\.google\.com\//, /^https:\/\/docs\.google\.com\//, /^https:\/\/console\.cloud\.google\.com\//];

let pendingFile: PickedFile | null = null;
let nextRequest = 1;
const waiting = new Map<number, (value: unknown) => void>();

function ask<T>(op: Extract<FromWorker, { kind: 'platform' }>['op'], args: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextRequest++;
  return new Promise<T>((resolve) => {
    waiting.set(id, resolve as (v: unknown) => void);
    post({ kind: 'platform', id, op, args }, transfer);
  });
}

function download(name: string, content: Uint8Array | string, type: string): Promise<boolean> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content.slice();
  return ask<boolean>('download', { name, bytes, type }, [bytes.buffer]);
}

const MIME: Record<string, string> = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', pdf: 'application/pdf', txt: 'text/plain' };
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

const platform: Platform = {
  async openFile() {
    // The page picks the file when you click (browsers only allow that during a click) and sends it with the request.
    const f = pendingFile;
    pendingFile = null;
    return f ? { name: f.name, bytes: new Uint8Array(f.bytes) } : null;
  },
  async saveFile(opts, content) {
    const ok = await download(opts.defaultName, content, mimeOf(opts.defaultName));
    return ok ? opts.defaultName : null;
  },
  async chooseFolder() {
    return 'Downloads';
  },
  async writeFiles(_folder, files) {
    // A browser can't write a folder, so the accountant package downloads as one zip file.
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.path, typeof f.content === 'string' ? new TextEncoder().encode(f.content) : f.content])));
    await download('Geranium accountant package.zip', zip, 'application/zip');
  },
  async openPath() {
    // Nothing to open: downloads go to the browser's download folder.
  },
  async openExternal(url) {
    if (!EXTERNAL_ALLOWED.some((re) => re.test(url))) throw new UserError('That link is not on the list of sites Geranium can open.');
    const opened = await ask<boolean>('open-url', { url });
    if (!opened) throw new UserError('Your browser blocked the window. Allow pop-ups for this site and try again.');
  },
  async openDocument(fileName, bytes) {
    await download(fileName, bytes, mimeOf(fileName));
  },
};

let state: AppState;
let registry: ReturnType<typeof buildRegistry>;
const changed = new Set<string>();
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = Date.now();
let unlockedAt = 0;

function onChanged(area: string) {
  changed.add(area);
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    const areas = [...changed];
    changed.clear();
    post({ kind: 'event', channel: 'data:changed', payload: areas });
  }, 50);
}

function lock(reason: string) {
  if (!state.ctx) return;
  state.lock();
  post({ kind: 'event', channel: 'app:locked', payload: reason });
}

// Auto-lock, as on the desktop: idle time and maximum session length from Settings.
setInterval(() => {
  if (!state?.ctx || state.demo) return;
  const a = getSettings(state.ctx).autoLock;
  if (!a.enabled) return;
  if (Date.now() - lastActivity > a.idleMinutes * 60_000) lock('idle');
  else if (a.maxSessionMinutes && Date.now() - unlockedAt > a.maxSessionMinutes * 60_000) lock('time-limit');
}, 15_000);

async function start(base: string) {
  setAppBase(base);
  vfs.onError = (message) => post({ kind: 'event', channel: 'storage:error', payload: message });
  await vfs.load();
  state = new AppState('/vault', unavailableProtector(), __APP_VERSION__, onChanged);
  registry = buildRegistry({ state, platform });
  post({ kind: 'ready' });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'start':
      try {
        await start(msg.base);
      } catch (err) {
        post({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    case 'invoke': {
      if (msg.file) pendingFile = msg.file;
      const wasUnlocked = !!state.ctx;
      const res = await dispatch(registry, state, msg.method, msg.input);
      if (msg.file && pendingFile === msg.file) pendingFile = null;
      if (!wasUnlocked && state.ctx) unlockedAt = lastActivity = Date.now();
      post({ kind: 'result', id: msg.id, res });
      return;
    }
    case 'reply':
      waiting.get(msg.id)?.(msg.value);
      waiting.delete(msg.id);
      return;
    case 'activity':
      lastActivity = Date.now();
      return;
    case 'hidden':
      // Save straight away when the tab is hidden or closing; lock if the user asked for that.
      state?.ctx?.db.saveNow();
      if (msg.lockIfSet && state?.ctx && !state.demo) {
        const a = getSettings(state.ctx).autoLock;
        if (a.enabled && a.onMinimise) lock('hidden');
      }
      await vfs.flush();
      return;
  }
};
