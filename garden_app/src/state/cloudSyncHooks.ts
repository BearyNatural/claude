/** Screens and app-wide timing for cloud sync. */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { CloudSyncController } from './cloudSync';

const DEBOUNCE_MS = 10_000;
const EVERY_MS = 5 * 60_000;

export function useCloudSync(controller: CloudSyncController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** Runs sync for the whole app: on open and return, after changes (debounced), and every few minutes while open. */
export function useCloudSyncRunner(controller: CloudSyncController, ready: boolean, dataVersion: unknown) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    void controller.load().then(() => controller.run());
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' || s === 'background') void controller.run();
    });
    const every = setInterval(() => void controller.run(), EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(every);
    };
  }, [controller, ready]);
  useEffect(() => {
    if (!ready || !controller.state.connection) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void controller.run(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [controller, ready, dataVersion]);
}
