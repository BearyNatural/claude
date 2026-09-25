/**
 * Backup & restore using the phone's own file providers. Restore is:
 * pick → validate → preview & warn → confirm → atomic replace.
 */
import React, { useState } from 'react';
import { CATALOGUE_VERSION } from '../src/data/plants';
import { backupFileName, createBackup, serialiseBackup } from '../src/domain/backup/format';
import { parseBackup, type ImportPreview } from '../src/domain/backup/restore';
import { formatDay } from '../src/domain/dates';
import { canSaveToFolder, pickBackupFile, saveBackupToFolder, shareBackup } from '../src/services/backup/fileAccess';
import { ENV } from '../src/services/env';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Choice, Notice, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { space } from '../src/ui/theme/theme';

export default function Backup() {
  const { store, data, today } = useGardenView();
  const [status, setStatus] = useState<{ tone: 'good' | 'danger' | 'caution'; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const photoCount = data.plantings.reduce((n, p) => n + (p.photos?.length ?? 0), 0);
  const [withPhotos, setWithPhotos] = useState(true);

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
      <Notice tone="info" title="Your garden lives on this phone">
        BearyNatural doesn&apos;t keep a copy. Clearing the app&apos;s data, uninstalling, or losing your phone can remove your garden records. A backup file protects them.
      </Notice>
      <Section title="Make a backup" subtitle={data.settings.lastBackupAt ? `Last backup: ${formatDay(data.settings.lastBackupAt.slice(0, 10), today)}` : 'No backup yet'}>
        <Card>
          <T variant="small">Includes your Garden Profile, areas, plantings and their history, journal, wish list, succession plans, reminder settings, task history and — if you choose — your plant photos. If you use the garden map, your saved address and outlines are included too. The plant catalogue and weather aren&apos;t included — the app recreates them.</T>
          {photoCount ? (
            <Choice<'yes' | 'no'>
              label={`Photos (${photoCount})`}
              options={[
                { value: 'yes', label: 'Include photos', description: `Keeps everything together. Adds roughly ${Math.max(1, Math.round(photoCount * 0.4))} MB to the backup file.` },
                { value: 'no', label: 'Leave photos out', description: 'A small file with your records only. Photos stay on this phone.' },
              ]}
              value={withPhotos ? 'yes' : 'no'}
              onChange={(v) => setWithPhotos(v === 'yes')}
            />
          ) : null}
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
