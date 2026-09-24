/** Collision-resistant local ids without native dependencies. */
export function newId(prefix = ''): string {
  const rand =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  return prefix ? `${prefix}_${rand}` : rand;
}
