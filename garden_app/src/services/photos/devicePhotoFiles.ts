/**
 * Plant photos, stored as files in the app's own documents folder on this
 * device (not the phone's gallery, and never uploaded). Photos are shrunk
 * when added — about 1600 px on the long side at 70% JPEG quality, typically
 * 0.2–0.4 MB — so they take little space and keep backups manageable.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { newId } from '../../domain/ids';
import type { PhotoFiles } from './photoFiles';

const MAX_EDGE = 1600;

function folder(): Directory {
  const d = new Directory(Paths.document, 'photos');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export const devicePhotoFiles: PhotoFiles = {
  async importImage(sourceUri, size) {
    const long = size ? Math.max(size.width, size.height) : undefined;
    const resize = long && long > MAX_EDGE ? [{ resize: size!.width >= size!.height ? { width: MAX_EDGE } : { height: MAX_EDGE } }] : [];
    const out = await manipulateAsync(sourceUri, resize, { compress: 0.7, format: SaveFormat.JPEG });
    const name = `${newId('ph')}.jpg`;
    await new File(out.uri).copy(new File(folder(), name));
    try {
      new File(out.uri).delete();
    } catch {
      // temporary file; the system cleans its cache anyway
    }
    return name;
  },
  uri(file) {
    return new File(folder(), file).uri;
  },
  exists(file) {
    return new File(folder(), file).exists;
  },
  list() {
    return folder()
      .list()
      .filter((x): x is File => x instanceof File)
      .map((f) => f.name);
  },
  remove(file) {
    const f = new File(folder(), file);
    if (f.exists) f.delete();
  },
  removeAll() {
    const d = new Directory(Paths.document, 'photos');
    if (d.exists) d.delete();
  },
  async readBase64(file) {
    return new File(folder(), file).base64();
  },
  writeBase64(file, base64) {
    const f = new File(folder(), file);
    if (f.exists) f.delete();
    f.create();
    f.write(base64, { encoding: 'base64' });
  },
};
