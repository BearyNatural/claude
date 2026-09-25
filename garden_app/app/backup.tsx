/**
 * Backup & restore using the phone's own file providers. Restore is:
 * pick → validate → preview & warn → confirm → atomic replace.
 */
import React, { useState } from 'react';
import { Platform } from 'react-native';
import { CATALOGUE_VERSION } from '../src/data/plants';
import { backupFileName, createBackup, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup, type ImportPreview } from '../src/domain/backup/restore';
import { formatDay } from '../src/domain/dates';
import { canSaveToFolder, pickBackupFile, saveBackupToFolder, shareBackup } from '../src/services/backup/fileAccess';
import { ENV } from '../src/services/env';
import { autoBackup } from '../src/state/appStore';
import { useAutoBackupSettings } from '../src/state/autoBackup';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Choice, Notice, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { space } from '../src/ui/theme/theme';

export default function Backup() {
  // Backups cover every garden, so counts use all the data, not just the garden shown.
  const { store, allData: data, today } = useGardenView();
  const [status, setStatus] = useState<{ tone: 'good' | 'danger' | 'caution'; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const photoCount = data.plantings.reduce((n, p) => n + (p.photos?.length ?? 0), 0);
  // Starts from Garden Profile › General (photos included unless turned off there).
  const [withPhotos, setWithPhotos] = useState(data.settings.backupPhotos ?? true);
  const auto = useAutoBackupSettings(autoBackup);

  const makeJson = async () => {
    const photos = withPhotos && photoCount ? await store.photoFilesForBackup() : undefined;
    return serialiseBackup(createBackup(store.exportData(), { now: new Date(), appVersion: ENV.appVersion, catalogueVersion: CATALOGUE_VERSION, photos }));
  };

  const exportIt = async (toFolder: boolean) => {
    setBusy(true);
    setStatus(null);
    const name = backupFileName(today);
    let json: string;
    try {
      json = await makeJson();
    } catch (e) {
      setStatus({ tone: 'danger', text: `The backup could not be prepared: ${e instanceof Error ? e.message : String(e)}` });
      setBusy(false);
      return;
    }
    const r = toFolder ? await saveBackupToFolder(json, name) : await shareBackup(json, name);
    if (r.ok) {
      await store.saveSettings({ lastBackupAt: new Date().toISOString() });
      setStatus({ tone: 'good', text: r.how === 'saved-to-folder' ? `Saved ${name}.` : r.how === 'downloaded' ? `Downloaded ${name}.` : `Backup ready (${name}). Choose where to keep it — e.g. Files, iCloud Drive, Google Drive or OneDrive.` });
    } else if (!r.cancelled) setStatus({ tone: 'danger', text: r.message });
    setBusy(false);
  };

  const pick = async () => {
    setBusy(true);
    setStatus(null);
    setPreview(null);
    const r = await pickBackupFile();
    setBusy(false);
    if (!r.ok) {
      if (!r.cancelled) setStatus({ tone: 'danger', text: r.message });
      return;
    }
    const parsed = parseBackup(r.text);
    if (!parsed.ok) setStatus({ tone: 'danger', text: `${parsed.message} Your current garden has not been changed.` });
    else setPreview(parsed);
  };

  const restore = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await store.restore(preview.data, preview.photos);
      setStatus({ tone: 'good', text: 'Restore complete. Your garden has been replaced with the backup.' });
      setPreview(null);
    } catch (e) {
      setStatus({ tone: 'danger', text: `Restore failed and nothing was changed: ${e instanceof Error ? e.message : String(e)}` });
    }
    setBusy(false);
  };

  return (
    <Screen>
      <Notice tone="info" title="Your garden lives on this device">
        BearyNatural doesn&apos;t keep a copy — your garden and any personal details stay on your own device. Clearing the app&apos;s data, uninstalling, or losing your device can remove your garden records. Keep your backup in your own cloud storage (Google Drive, OneDrive or iCloud Drive): it protects your records and lets you open the same garden in the phone app and the browser version by restoring it there.
      </Notice>
      <Section title="Automatic backup" subtitle={autoBackup.supported ? undefined : Platform.OS === 'web' ? 'Available in the Android app' : undefined}>
        <Card>
          {!autoBackup.supported ? (
            <T variant="small">
              {Platform.OS === 'web'
                ? 'Browsers don\'t let websites save to your cloud storage by themselves, so in the browser use "Back up now" below and keep the file in Google Drive, OneDrive or iCloud Drive. The Android app can keep a backup up to date automatically.'
                : 'Automatic backup isn\'t available on this device. Use "Back up now" below.'}
            </T>
          ) : auto ? (
            <>
              <T variant="small">{`On — keeping ${'SowBySeason-AutoBackup.json'} up to date in ${auto.folderName ? `“${auto.folderName}”` : 'your chosen folder'} whenever your garden changes.`}</T>
              <T variant="tiny" muted>{auto.lastSavedAt ? `Last saved ${formatDay(auto.lastSavedAt.slice(0, 10), today)} at ${new Date(auto.lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Not saved yet.'}</T>
              {auto.lastError ? <Notice tone="caution">{auto.lastError}</Notice> : null}
              <Choice<'yes' | 'no'>
                label={photoCount ? `Photos in the automatic backup (${photoCount})` : 'Photos in the automatic backup (none yet)'}
                options={[
                  { value: 'yes', label: 'Include photos' },
                  { value: 'no', label: 'Records only (smaller file)' },
                ]}
                value={auto.includePhotos ? 'yes' : 'no'}
                onChange={(v) => { void autoBackup.setIncludePhotos(v === 'yes'); void store.saveSettings({ backupPhotos: v === 'yes' }); }}
              />
              <Row wrap gap={space.sm}>
                <Button compact icon="cloud-upload-outline" label={autoBackup.busy ? 'Saving…' : 'Save now'} loading={autoBackup.busy} onPress={() => void autoBackup.run(true)} />
                <Button compact variant="secondary" icon="folder-outline" label="Change folder" onPress={() => void autoBackup.enable()} />
                <Button compact variant="ghost" label="Turn off" onPress={() => void autoBackup.disable()} />
              </Row>
            </>
          ) : (
            <>
              <T variant="small">Choose a folder once — for example in Google Drive or OneDrive — and the app keeps a backup there automatically whenever your garden changes. To use your garden in the browser or on a new phone, restore from that file.</T>
              <Button icon="cloud-outline" label="Choose a backup folder" onPress={() => void autoBackup.enable()} />
              <T variant="tiny" muted>Android asks you to pick the folder and gives the app access to that folder only.</T>
            </>
          )}
        </Card>
      </Section>
      <Section title="Make a backup" subtitle={data.settings.lastBackupAt ? `Last backup: ${formatDay(data.settings.lastBackupAt.slice(0, 10), today)}` : 'No backup yet'}>
        <Card>
          <T variant="small">Includes your Garden Profile, areas, plantings and their history, journal, wish list, succession plans, reminder settings, task history and — if you choose — your plant photos. If you use the garden map, your saved address and outlines are included too. The plant catalogue and weather aren&apos;t included — the app recreates them.</T>
          <Choice<'yes' | 'no'>
            label={photoCount ? `Photos (${photoCount})` : 'Photos (none yet)'}
            options={[
              { value: 'yes', label: 'Include photos', description: photoCount ? `Keeps everything together. Adds roughly ${Math.max(1, Math.round(photoCount * 0.4))} MB to the backup file.` : 'Photos you add to plantings will be included.' },
              { value: 'no', label: 'Leave photos out', description: 'A small file with your records only. Photos stay on this device.' },
            ]}
            value={withPhotos ? 'yes' : 'no'}
            onChange={(v) => setWithPhotos(v === 'yes')}
          />
          <T variant="tiny" muted>The starting choice comes from Garden Profile › General.</T>
          <Button icon="share-outline" label="Back up now" onPress={() => exportIt(false)} loading={busy} />
          {canSaveToFolder() ? <Button variant="secondary" icon="folder-outline" label="Save to a folder…" onPress={() => exportIt(true)} disabled={busy} /> : null}
        </Card>
      </Section>
      <Section title="Restore from a backup">
        <Card>
          <T variant="small">Choose a Sow by Season backup file. We check it before anything changes.</T>
          <Button variant="secondary" icon="document-outline" label="Choose backup file" onPress={pick} disabled={busy} />
        </Card>
      </Section>
      {preview ? (
        <Card tone="caution">
          <T variant="h3">Replace your current garden?</T>
          <T variant="small">{`Backup from ${preview.createdAt ? formatDay(preview.createdAt.slice(0, 10), today) : 'an unknown date'}${preview.appVersion ? ` (app ${preview.appVersion})` : ''}: ${preview.counts.plantings} plantings, ${preview.counts.areas} areas, ${preview.counts.journal} journal notes, ${preview.counts.wishlist} wish-list plants, ${preview.counts.successionPlans} succession plans${preview.counts.photos ? `, ${preview.counts.photos} photos` : ''}.`}</T>
          {preview.migratedFrom ? <T variant="tiny" muted>{`Upgraded from an older backup format (${preview.migrations.join(', ')}).`}</T> : null}
          {preview.warnings.map((w, i) => (
            <T key={i} variant="small">{`• ${w}`}</T>
          ))}
          <T variant="small" style={{ fontWeight: '600' }}>{`This will replace everything currently in the app (${data.plantings.length} plantings, ${data.areas.length} areas). Consider backing up first.`}</T>
          <Row gap={space.sm} wrap>
            <Button variant="danger" icon="refresh" label="Replace with backup" onPress={restore} loading={busy} />
            <Button variant="secondary" label="Cancel" onPress={() => setPreview(null)} />
          </Row>
        </Card>
      ) : null}
      {status ? <Notice tone={status.tone === 'good' ? 'good' : status.tone === 'danger' ? 'danger' : 'caution'}>{status.text}</Notice> : null}
    </Screen>
  );
}
