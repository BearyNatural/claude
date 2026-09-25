/**
 * Automatic backup to a folder the gardener chooses once — for example a
 * Google Drive or OneDrive folder, through Android's own folder picker, which
 * grants lasting access to that folder only. The app then keeps one file there
 * (SowBySeason-AutoBackup.json) up to date whenever the garden changes.
 * Settings live on this device only (not in backups): the folder link is
 * specific to this phone.
 */
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { KeyValueStore } from '../storage/keyValueStore';

export const AUTO_BACKUP_FILE = 'SowBySeason-AutoBackup.json';
const KEY = 'sbs:local:autoBackup';

export interface AutoBackupSettings {
  folderUri: string;
  folderName?: string;
  includePhotos: boolean;
  lastSavedAt?: string;
  /** Fingerprint of what was last saved, to skip unchanged saves. */
  lastHash?: string;
  lastError?: string;
}

export function autoBackupSupported(): boolean {
  return Platform.OS === 'android' && typeof (Directory as unknown as { pickDirectoryAsync?: unknown }).pickDirectoryAsync === 'function';
}

export async function loadAutoBackup(store: KeyValueStore): Promise<AutoBackupSettings | null> {
  try {
    const raw = await store.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as AutoBackupSettings) : null;
    return s && typeof s.folderUri === 'string' ? s : null;
  } catch {
    return null;
  }
}

export async function saveAutoBackup(store: KeyValueStore, s: AutoBackupSettings | null): Promise<void> {
  if (s) await store.setItem(KEY, JSON.stringify(s));
  else await store.removeItem(KEY);
}

/** Ask the gardener to pick the folder (returns null if they cancel). */
export async function chooseBackupFolder(): Promise<{ uri: string; name?: string } | null> {
  try {
    const dir = await (Directory as unknown as { pickDirectoryAsync: () => Promise<Directory | null> }).pickDirectoryAsync();
    if (!dir) return null;
    return { uri: dir.uri, name: decodeURIComponent(dir.name ?? '').split(/[:/]/).pop() || undefined };
  } catch {
    return null;
  }
}

/** Write (or overwrite) the automatic backup file in the chosen folder. */
export function writeAutoBackupFile(folderUri: string, json: string): void {
  const dir = new Directory(folderUri);
  const existing = dir.list().find((x): x is File => x instanceof File && x.name === AUTO_BACKUP_FILE);
  const file = existing ?? dir.createFile(AUTO_BACKUP_FILE, 'application/json');
  file.write(json);
}
