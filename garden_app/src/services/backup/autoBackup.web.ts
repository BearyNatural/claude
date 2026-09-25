/**
 * Browser version: websites can't save to a cloud folder on their own, so
 * automatic backup isn't offered here. Manual backups (download) still work.
 */
import type { KeyValueStore } from '../storage/keyValueStore';

export const AUTO_BACKUP_FILE = 'SowBySeason-AutoBackup.json';

export interface AutoBackupSettings {
  folderUri: string;
  folderName?: string;
  includePhotos: boolean;
  lastSavedAt?: string;
  lastHash?: string;
  lastError?: string;
}

export const autoBackupSupported = () => false;
export const loadAutoBackup = async (_store: KeyValueStore): Promise<AutoBackupSettings | null> => null;
export const saveAutoBackup = async (_store: KeyValueStore, _s: AutoBackupSettings | null): Promise<void> => undefined;
export const chooseBackupFolder = async (): Promise<{ uri: string; name?: string } | null> => null;
export function writeAutoBackupFile(_folderUri: string, _json: string): void {
  throw new Error('Automatic backup is not available in the browser.');
}
