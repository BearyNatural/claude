import { Buffer } from 'buffer';

// The app's storage and crypto code uses Node's Buffer; the browser build provides the
// standard polyfill. This module must be imported before anything else in the worker.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
