/**
 * Photos kept with a planting: take one, add from the gallery, add a caption,
 * or remove. Files live in the app's own storage on this phone.
 */
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { formatDay } from '../../domain/dates';
import type { Planting } from '../../domain/types';
import type { GardenStore } from '../../state/gardenStore';
import { space, usePalette } from '../theme/theme';
import { Button, Card, Field, Notice, Row, T } from './primitives';

const THUMB = 84;

/** The newest photo of a planting that is on this phone, for list thumbnails. */
export function latestPhotoUri(p: Planting, store: { photoExists(f: string): boolean; photoUri(f: string): string }): string | undefined {
  const ph = [...(p.photos ?? [])].reverse().find((x) => store.photoExists(x.file));
  return ph ? store.photoUri(ph.file) : undefined;
}

export function PlantingPhotos({ planting, store, today }: { planting: Planting; store: GardenStore; today: string }) {
  const p = usePalette();
  const photos = planting.photos ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const open = photos.find((x) => x.id === openId);

  const add = async (from: 'camera' | 'library') => {
    setMessage(null);
    try {
      if (from === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setMessage('Camera access was not allowed. You can allow it in your phone\'s settings, or add a photo from your gallery instead.');
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
      const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 10 });
      if (res.canceled || !res.assets?.length) return;
      setBusy(true);
      await store.addPhotos(planting.id, res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
    } catch (e) {
      setMessage(`The photo could not be added: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {photos.map((ph) => (
            <Pressable
              key={ph.id}
              onPress={() => { setOpenId(ph.id === openId ? null : ph.id); setCaption(ph.caption ?? ''); setConfirmDelete(false); }}
              accessibilityRole="button"
              accessibilityLabel={`Photo from ${formatDay(ph.takenAt.slice(0, 10), today)}${ph.caption ? `: ${ph.caption}` : ''}`}
              style={{ borderRadius: 10, borderWidth: ph.id === openId ? 3 : 0, borderColor: p.primary, overflow: 'hidden' }}
            >
              {store.photoExists(ph.file) ? (
                <Image source={{ uri: store.photoUri(ph.file) }} style={{ width: THUMB, height: THUMB, backgroundColor: p.primarySoft }} />
              ) : (
                <View style={{ width: THUMB, height: THUMB, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                  <T variant="tiny" muted style={{ textAlign: 'center' }}>Not on this phone</T>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <T variant="small" muted>No photos yet. Add one so you can recognise this plant at a glance and see how it grows.</T>
      )}

      {open ? (
        <Card>
          {store.photoExists(open.file) ? (
            <Image source={{ uri: store.photoUri(open.file) }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: p.primarySoft }} resizeMode="contain" accessibilityIgnoresInvertColors />
          ) : (
            <Notice tone="caution">This photo isn&apos;t on this phone — it may have been left out of a backup you restored.</Notice>
          )}
          <T variant="tiny" muted>{`Added ${formatDay(open.takenAt.slice(0, 10), today)}`}</T>
          <Field label="Caption (optional)" value={caption} onChangeText={setCaption} placeholder="e.g. First flowers, north side" />
          <Row wrap gap={space.sm}>
            <Button compact label="Save caption" icon="checkmark" disabled={caption.trim() === (open.caption ?? '')} onPress={() => void store.setPhotoCaption(planting.id, open.id, caption)} />
            {confirmDelete ? (
              <>
                <Button compact variant="danger" label="Delete photo" onPress={async () => { await store.removePhoto(planting.id, open.id); setOpenId(null); setConfirmDelete(false); }} />
                <Button compact variant="secondary" label="Keep" onPress={() => setConfirmDelete(false)} />
              </>
            ) : (
              <Button compact variant="ghost" icon="trash-outline" label="Delete" onPress={() => setConfirmDelete(true)} />
            )}
          </Row>
        </Card>
      ) : null}

      <Row wrap gap={space.sm}>
        <Button compact icon="camera-outline" label="Take photo" onPress={() => void add('camera')} loading={busy} />
        <Button compact variant="secondary" icon="images-outline" label="Add from gallery" onPress={() => void add('library')} disabled={busy} />
      </Row>
      {message ? <Notice tone="caution">{message}</Notice> : null}
      <T variant="tiny" muted>Photos stay on this phone (in the app&apos;s own storage, not your gallery) and are shrunk to save space. You can include them in backups.</T>
    </View>
  );
}
