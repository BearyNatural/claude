/**
 * Minimal async key-value interface. Implemented by AsyncStorage on device/web
 * (see asyncStorageStore.ts) and by MemoryStore in tests.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  /** Test hook: throw on the Nth write to simulate storage failures. */
  failAfterWrites: number | null = null;
  private writes = 0;

  private tick() {
    this.writes++;
    if (this.failAfterWrites !== null && this.writes > this.failAfterWrites) {
      throw new Error('Simulated storage failure');
    }
  }
  async getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async setItem(key: string, value: string) {
    this.tick();
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
  async getAllKeys() {
    return [...this.map.keys()];
  }
  async multiGet(keys: readonly string[]) {
    return keys.map((k) => [k, this.map.has(k) ? this.map.get(k)! : null] as const);
  }
  async multiSet(pairs: readonly (readonly [string, string])[]) {
    for (const [k, v] of pairs) {
      this.tick();
      this.map.set(k, v);
    }
  }
  async multiRemove(keys: readonly string[]) {
    for (const k of keys) this.map.delete(k);
  }
}
