/**
 * Photo storage contract used by the garden store, plus an in-memory
 * implementation for tests. The device implementation (expo-file-system) is in
 * devicePhotoFiles.ts so this file stays free of native modules.
 */

/** What the garden store needs from photo storage (a memory fake is used in tests). */
export interface PhotoFiles {
  /** Finish loading stored photos (the browser version keeps them in IndexedDB). */
  ready?(): Promise<void>;
  /** Copy (and shrink) a picked or captured image into app storage; returns its file name. */
  importImage(sourceUri: string, size?: { width: number; height: number }): Promise<string>;
  uri(file: string): string;
  exists(file: string): boolean;
  /** File names currently stored. */
  list(): string[];
  remove(file: string): void;
  removeAll(): void;
  readBase64(file: string): Promise<string>;
  writeBase64(file: string, base64: string): void;
}

/** In-memory stand-in for tests and anywhere files aren't available. */
export function memoryPhotoFiles(): PhotoFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  let n = 0;
  return {
    files,
    async importImage() {
      const name = `ph_test${++n}.jpg`;
      files.set(name, 'AAAA');
      return name;
    },
    uri: (file) => `memory://${file}`,
    exists: (file) => files.has(file),
    list: () => [...files.keys()],
    remove: (file) => void files.delete(file),
    removeAll: () => files.clear(),
    readBase64: async (file) => files.get(file) ?? '',
    writeBase64: (file, b64) => void files.set(file, b64),
  };
}
