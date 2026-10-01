import type { ApiResult } from '../main/api';

/** Messages between the page (bridge.ts) and the app worker (worker.ts). */

export interface PickedFile {
  name: string;
  bytes: ArrayBuffer;
}

export type ToWorker =
  | { kind: 'start'; base: string }
  | { kind: 'invoke'; id: number; method: string; input: unknown; file?: PickedFile }
  | { kind: 'reply'; id: number; value: unknown }
  | { kind: 'activity' }
  | { kind: 'hidden'; lockIfSet: boolean };

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }
  | { kind: 'result'; id: number; res: ApiResult<unknown> }
  | { kind: 'event'; channel: string; payload: unknown }
  | { kind: 'platform'; id: number; op: 'download' | 'open-url'; args: Record<string, unknown> };
