import '../renderer/styles.css';
import { createBridge } from './bridge';

/**
 * Entry point of Geranium in the browser: starts the app worker, installs the same
 * `window.geranium` bridge the desktop app has, then loads the normal UI.
 */

function message(title: string, body: string) {
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'web-message';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  box.append(h, p);
  root.append(box);
}

async function boot() {
  if (!('indexedDB' in window) || !('Worker' in window) || !globalThis.crypto?.subtle) {
    message('This browser can’t run Geranium', 'Please use a current version of Firefox, Chrome, Edge or Safari, and not a private window.');
    return;
  }
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'geranium' });
  const base = new URL('./', document.baseURI).href;
  try {
    (window as unknown as { geranium: unknown }).geranium = await createBridge(worker, base);
  } catch (err) {
    message('Geranium couldn’t start', `${err instanceof Error ? err.message : String(err)}. If this is a private window, try a normal one.`);
    return;
  }
  // Ask the browser to keep this site's data (it may still be cleared if you clear site data yourself).
  void navigator.storage?.persist?.();
  await import('../renderer/main');
}

// One tab at a time: two tabs editing the same encrypted data would overwrite each other.
if (navigator.locks) {
  void navigator.locks.request('geranium-data', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      message('Geranium is already open', 'Geranium is open in another tab or window of this browser. Use that one, or close it and reload this page.');
      return;
    }
    await boot();
    // Hold the lock for as long as this tab is open.
    await new Promise(() => undefined);
  });
} else {
  void boot();
}
