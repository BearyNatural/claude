import type { FromWorker, PickedFile, ToWorker } from './protocol';
import type { ApiResult } from '../main/api';

/**
 * The page side of Geranium in the browser. It provides the same `window.geranium` bridge the
 * desktop preload does, backed by the app worker instead of Electron's main process.
 *
 * Browsers only allow file pickers and pop-ups during a click, so for the few requests that need
 * one, the file is picked (or the window opened) here first, then the request goes to the worker.
 */

/** Requests that start by asking for a file, and the file types each accepts. */
const FILE_METHODS: Record<string, string> = {
  'imports.chooseFile': '.csv,.txt,.ofx,.qfx,.qif,.xlsx,.xls,.pdf',
  'investments.chooseTradesCsv': '.csv,.txt',
  'documents.attach': '.pdf,.png,.jpg,.jpeg,.heic,.webp,.csv,.txt,.xlsx,.xls,.docx,.doc,.ofx,.qfx,.qif',
  'backup.choose': '.geranium-backup,.pbbackup',
};

/** Requests that open another window (Google sign-in in a pop-up, a spreadsheet in a new tab). */
const WINDOW_METHODS: Record<string, string | undefined> = {
  'google.connect': 'popup,width=520,height=700',
  'google.openExport': undefined,
};

type Listener = (payload: unknown) => void;

export interface WebBridge {
  invoke(method: string, input?: unknown): Promise<ApiResult<unknown>>;
  on(channel: string, cb: Listener): () => void;
  activity(): void;
  platform: 'web';
}

function pickFile(accept: string): Promise<File | null> {
  // Runs synchronously up to input.click(), so the click still counts as the user's.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const done = (f: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(f);
    };
    // Older browsers have no 'cancel' event: treat "focus came back with no file" as cancelled.
    const onFocus = () => setTimeout(() => done(input.files?.[0] ?? null), 1500);
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

function saveDownload(name: string, bytes: ArrayBuffer, type: string): boolean {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function createBridge(worker: Worker, base: string): Promise<WebBridge> {
  const listeners = new Map<string, Set<Listener>>();
  const pending = new Map<number, (res: ApiResult<unknown>) => void>();
  let nextId = 1;
  let openWindow: Window | null = null;
  const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
  const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((l) => l(payload));

  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      switch (msg.kind) {
        case 'ready':
          resolve();
          return;
        case 'failed':
          reject(new Error(msg.message));
          return;
        case 'result':
          pending.get(msg.id)?.(msg.res);
          pending.delete(msg.id);
          return;
        case 'event':
          emit(msg.channel, msg.payload);
          return;
        case 'platform': {
          let value: unknown = false;
          if (msg.op === 'download') {
            const a = msg.args as { name: string; bytes: Uint8Array; type: string };
            value = saveDownload(a.name, a.bytes.buffer as ArrayBuffer, a.type);
          } else if (msg.op === 'open-url') {
            const url = String(msg.args.url);
            const w = openWindow && !openWindow.closed ? openWindow : window.open('about:blank', '_blank');
            openWindow = null;
            if (w) {
              w.opener = null;
              w.location.href = url;
              value = true;
            }
          }
          send({ kind: 'reply', id: msg.id, value });
          return;
        }
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'Geranium could not start in this browser.'));
  });
  send({ kind: 'start', base });

  let lastActivity = 0;
  const bridge: WebBridge = {
    platform: 'web',
    async invoke(method, input) {
      let file: PickedFile | undefined;
      if (method in WINDOW_METHODS) openWindow = window.open('about:blank', method === 'google.connect' ? 'geranium-google' : '_blank', WINDOW_METHODS[method]);
      if (method in FILE_METHODS) {
        const f = await pickFile(FILE_METHODS[method]);
        if (!f) return { ok: true, data: null };
        file = { name: f.name, bytes: await f.arrayBuffer() };
      }
      const id = nextId++;
      const res = new Promise<ApiResult<unknown>>((resolve) => pending.set(id, resolve));
      send({ kind: 'invoke', id, method, input, file }, file ? [file.bytes] : []);
      const out = await res;
      if (openWindow && !out.ok) openWindow.close();
      return out;
    },
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb);
      return () => listeners.get(channel)?.delete(cb);
    },
    activity() {
      if (Date.now() - lastActivity < 5000) return;
      lastActivity = Date.now();
      send({ kind: 'activity' });
    },
  };

  // Save as soon as the tab is hidden or closed; lock on hide if Settings say so.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send({ kind: 'hidden', lockIfSet: true });
  });
  window.addEventListener('pagehide', () => send({ kind: 'hidden', lockIfSet: false }));

  return ready.then(() => bridge);
}
