import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiInput, ApiMethod, ApiOutput, ApiResult } from '../../main/api';

/** Typed access to the main-process API through the preload bridge. */

interface Bridge {
  invoke(method: string, input?: unknown): Promise<ApiResult<unknown>>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
  activity(): void;
  platform: string;
}

declare global {
  interface Window {
    geranium: Bridge;
  }
}

/** True in the browser version (its bridge is installed before the UI loads). */
export const IS_WEB = typeof window !== 'undefined' && window.geranium?.platform === 'web';

export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function api<K extends ApiMethod>(method: K, ...input: undefined extends ApiInput<K> ? [ApiInput<K>?] : [ApiInput<K>]): Promise<ApiOutput<K>> {
  const res = await window.geranium.invoke(method, input[0]);
  if (!res.ok) {
    const err = new ApiError(res.error?.code ?? 'ERROR', res.error?.message ?? 'Something went wrong.');
    if (err.code === 'LOCKED') window.dispatchEvent(new CustomEvent('geranium:locked'));
    throw err;
  }
  return res.data as ApiOutput<K>;
}

type Listener = (areas: string[]) => void;
const listeners = new Set<Listener>();
let wired = false;

function wire() {
  if (wired || !window.geranium) return;
  wired = true;
  window.geranium.on('data:changed', (areas) => {
    for (const l of listeners) l(areas as string[]);
  });
}

export function onDataChanged(l: Listener): () => void {
  wire();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tell other screens data changed after a local mutation. */
export function notifyChanged(area = 'local') {
  for (const l of listeners) l([area]);
}

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data and reload it when the main process reports a change. `key` should change
 * whenever the input changes.
 */
export function useApi<K extends ApiMethod>(method: K, input: ApiInput<K> | undefined, key: unknown[] = [], enabled = true): Query<ApiOutput<K>> {
  const [data, setData] = useState<ApiOutput<K>>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const load = useCallback(() => {
    if (!enabled) return;
    const n = ++seq.current;
    setLoading(true);
    (api as (m: string, i?: unknown) => Promise<ApiOutput<K>>)(method, inputRef.current)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => n === seq.current && setError(e.message))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, enabled, JSON.stringify(key)]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onDataChanged(() => load()), [load]);
  return { data, error, loading, reload: load };
}

/**
 * Shared, cached result for input-less list calls used by many components at once
 * (categories, accounts). Loaded once and refreshed when the main process reports a change.
 */
interface SharedEntry {
  value: unknown;
  promise: Promise<unknown> | null;
  /** A change arrived while a load was in flight, so load again when it finishes. */
  dirty: boolean;
  subs: Set<() => void>;
  areas: string[];
  load: () => void;
}
const cache = new Map<string, SharedEntry>();
let sharedWired = false;

function wireShared() {
  if (sharedWired) return;
  sharedWired = true;
  onDataChanged((changed) => {
    for (const e of cache.values()) {
      if (!changed.some((a) => e.areas.includes(a) || a === 'all')) continue;
      // Reload now if something shows it; otherwise forget it so the next screen loads it fresh.
      if (e.subs.size) e.load();
      else if (e.promise) e.dirty = true;
      else e.value = undefined;
    }
  });
}

export function useShared<K extends ApiMethod>(method: K, areas: string[]): ApiOutput<K> | undefined {
  const [, force] = useState(0);
  let e = cache.get(method);
  if (!e) {
    const entry: SharedEntry = {
      value: undefined,
      promise: null,
      dirty: false,
      subs: new Set(),
      areas,
      load: () => {
        if (entry.promise) {
          entry.dirty = true;
          return;
        }
        entry.promise = (api as (m: string, i?: unknown) => Promise<unknown>)(method, method === 'categories.list' ? {} : undefined)
          .then((v) => { entry.value = v; entry.subs.forEach((s) => s()); })
          .catch(() => undefined)
          .finally(() => {
            entry.promise = null;
            if (entry.dirty) {
              entry.dirty = false;
              entry.load();
            }
          });
      },
    };
    cache.set(method, entry);
    e = entry;
  }
  wireShared();
  const current = e;
  useEffect(() => {
    const sub = () => force((n) => n + 1);
    current.subs.add(sub);
    if (current.value === undefined) current.load();
    return () => {
      current.subs.delete(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);
  return current.value as ApiOutput<K> | undefined;
}

/** Forget cached lists (after unlocking a different database or entering demo mode). */
export function clearShared() {
  for (const e of cache.values()) e.value = undefined;
}

/** Run a mutation with pending/error state. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn]);
  return { run, pending, error, setError };
}
