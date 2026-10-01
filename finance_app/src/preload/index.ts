import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the UI and the main process. The UI can call the API and listen to
 * a fixed list of events — it has no access to Node.js, the file system or the network.
 */
const EVENTS = new Set(['data:changed', 'app:locked', 'navigate']);

contextBridge.exposeInMainWorld('geranium', {
  invoke: (method: string, input?: unknown) => ipcRenderer.invoke('api', method, input),
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.has(channel)) return () => undefined;
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  activity: () => ipcRenderer.send('activity'),
  platform: process.platform,
});
