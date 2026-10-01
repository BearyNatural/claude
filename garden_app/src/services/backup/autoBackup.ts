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
  /** Link to the backup file this app created, so it's overwritten rather than duplicated. */
  fileUri?: string;
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

/**
 * Write (or overwrite) the automatic backup file in the chosen folder and
 * return its link, which the caller keeps so the same file is reused next time.
 *
 * Cloud folders (Google Drive, OneDrive) give files opaque links, so the file
 * can't be found again by its name — that is why the link is remembered.
 * Some storage apps also don't shorten a file when it's overwritten, which
 * would leave old data on the end; the size is checked after writing and, if
 * it's wrong, the file is replaced with a fresh one.
 */
export function writeAutoBackupFile(folderUri: string, json: string, knownFileUri?: string): string {
  const dir = new Directory(folderUri);
  let file = knownFileUri ? new File(knownFileUri) : null;
  if (file && !safeExists(file)) file = null;
  // Folders on the phone itself keep the name in the link ("…%2FSowBySeason-AutoBackup.json").
  file ??= dir.list().find((x): x is File => x instanceof File && /[/:]SowBySeason-AutoBackup\.json$/.test(safeDecode(x.uri))) ?? null;
  if (!file) return createAndWrite(dir, json);
  file.write(json);
  if (writtenCorrectly(file, json)) return file.uri;
  file.delete();
  return createAndWrite(dir, json);
}

function createAndWrite(dir: Directory, json: string): string {
  const file = dir.createFile(AUTO_BACKUP_FILE, 'application/json');
  file.write(json);
  return file.uri;
}

function writtenCorrectly(file: File, json: string): boolean {
  try {
    const expected = new TextEncoder().encode(json).length;
    if (file.size === expected) return true;
    return file.textSync() === json;
  } catch {
    return true; // Can't check on this phone; the write itself succeeded.
  }
}

function safeExists(file: File): boolean {
  try {
    return file.exists;
  } catch {
    return false;
  }
}

function safeDecode(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}
