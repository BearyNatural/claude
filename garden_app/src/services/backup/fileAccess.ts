/**
 * Backup file access using the operating system's own document mechanisms —
 * no custom cloud integrations.
 *
 * Export
 *  - iOS/Android: write the JSON to the app cache, then open the system share
 *    sheet (expo-sharing). The gardener chooses the destination: "Save to
 *    Files" (iCloud Drive, On My iPhone), Google Drive, OneDrive, Dropbox,
 *    email, etc. — whatever providers are installed.
 *  - Android also offers "Save to folder…", using the Storage Access
 *    Framework directory picker (expo-file-system Directory.pickDirectoryAsync)
 *    so the file can be written straight into Downloads or a provider folder.
 *  - Web: a normal browser download.
 *
 * Import
 *  - expo-document-picker opens the system document picker (Files app /
 *    Android document UI, including cloud providers). The file is copied to
 *    the cache and read as text; nothing is changed until it has been
 *    validated and the gardener confirms.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MAX_BACKUP_BYTES } from '../../domain/backup/restore';
import { Platform } from 'react-native';

export type ExportResult = { ok: true; how: 'shared' | 'saved-to-folder' | 'downloaded' } | { ok: false; cancelled?: boolean; message: string };

export function canSaveToFolder(): boolean {
  return Platform.OS === 'android' && typeof (Directory as unknown as { pickDirectoryAsync?: unknown }).pickDirectoryAsync === 'function';
}

export async function shareBackup(json: string, fileName: string): Promise<ExportResult> {
  if (Platform.OS === 'web') return downloadOnWeb(json, fileName);
  try {
    const file = new File(Paths.cache, fileName);
    if (file.exists) file.delete();
    file.create();
    file.write(json);
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Sow by Season backup', UTI: 'public.json' });
    return { ok: true, how: 'shared' };
  } catch (e) {
    return { ok: false, message: `The backup could not be shared: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function saveBackupToFolder(json: string, fileName: string): Promise<ExportResult> {
  if (!canSaveToFolder()) return shareBackup(json, fileName);
  try {
    const picker = (Directory as unknown as { pickDirectoryAsync: () => Promise<Directory | null> }).pickDirectoryAsync;
    const dir = await picker();
    if (!dir) return { ok: false, cancelled: true, message: 'No folder chosen.' };
    const file = dir.createFile(fileName, 'application/json');
    file.write(json);
    return { ok: true, how: 'saved-to-folder' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return { ok: false, cancelled: true, message: 'No folder chosen.' };
    return { ok: false, message: `The backup could not be saved: ${msg}` };
  }
}

function downloadOnWeb(json: string, fileName: string): ExportResult {
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, how: 'downloaded' };
  } catch (e) {
    return { ok: false, message: `The download could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type PickResult = { ok: true; text: string; name: string } | { ok: false; cancelled?: boolean; message: string };

export async function pickBackupFile(): Promise<PickResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return { ok: false, cancelled: true, message: 'No file chosen.' };
    const asset = res.assets[0];
    if (asset.size !== undefined && asset.size > MAX_BACKUP_BYTES) {
      return { ok: false, message: 'That file is too large to be a Sow by Season backup.' };
    }
    let text: string;
    if (Platform.OS === 'web') {
      const f = (asset as unknown as { file?: Blob }).file;
      text = f ? await f.text() : await (await fetch(asset.uri)).text();
    } else {
      text = await new File(asset.uri).text();
    }
    return { ok: true, text, name: asset.name };
  } catch (e) {
    return { ok: false, message: `The file could not be opened: ${e instanceof Error ? e.message : String(e)}` };
  }
}
