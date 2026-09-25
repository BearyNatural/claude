/**
 * Automatic backup controller: keeps SowBySeason-AutoBackup.json in the
 * gardener's chosen folder up to date. Saves shortly after the garden changes
 * and when the app goes into the background — only if something changed.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { CATALOGUE_VERSION } from '../data/plants';
import { createBackup, fnv1a, serialiseBackup, stableStringify } from '../domain/backup/format';
import {
  autoBackupSupported,
  chooseBackupFolder,
  loadAutoBackup,
  saveAutoBackup,
  writeAutoBackupFile,
  type AutoBackupSettings,
} from '../services/backup/autoBackup';
import { ENV } from '../services/env';
import type { KeyValueStore } from '../services/storage/keyValueStore';
import type { GardenStore } from './gardenStore';

const DEBOUNCE_MS = 30_000;

export class AutoBackupController {
  private listeners = new Set<() => void>();
  settings: AutoBackupSettings | null = null;
  busy = false;
  private loaded = false;

  constructor(private garden: GardenStore, private local: KeyValueStore) {}

  readonly supported = autoBackupSupported();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.settings;
  private emit() {
    this.settings = this.settings ? { ...this.settings } : null;
    this.listeners.forEach((l) => l());
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    this.settings = this.supported ? await loadAutoBackup(this.local) : null;
    this.emit();
  }

  /** Pick the folder and turn automatic backup on (saves straight away). */
  async enable(): Promise<boolean> {
    const folder = await chooseBackupFolder();
    if (!folder) return false;
    this.settings = { folderUri: folder.uri, folderName: folder.name, includePhotos: this.settings?.includePhotos ?? this.garden.state.data.settings.backupPhotos ?? true };
    await saveAutoBackup(this.local, this.settings);
    this.emit();
    await this.run(true);
    return true;
  }

  async disable() {
    this.settings = null;
    await saveAutoBackup(this.local, null);
    this.emit();
  }

  async setIncludePhotos(includePhotos: boolean) {
    if (!this.settings) return;
    this.settings = { ...this.settings, includePhotos };
    await saveAutoBackup(this.local, this.settings);
    this.emit();
    await this.run(true);
  }

  /** Save now if anything changed since the last automatic backup (or always, when forced). */
  async run(force = false) {
    const s = this.settings;
    if (!s || this.busy || this.garden.state.status !== 'ready') return;
    const data = this.garden.exportData();
    const photoNames = s.includePhotos ? data.plantings.flatMap((p) => (p.photos ?? []).map((ph) => ph.file)).sort() : [];
    const hash = fnv1a(stableStringify({ data, photoNames }));
    if (!force && hash === s.lastHash) return;
    this.busy = true;
    this.emit();
    try {
      const photos = s.includePhotos ? await this.garden.photoFilesForBackup() : undefined;
      const json = serialiseBackup(createBackup(data, { now: new Date(), appVersion: ENV.appVersion, catalogueVersion: CATALOGUE_VERSION, photos }));
      writeAutoBackupFile(s.folderUri, json);
      this.settings = { ...s, lastSavedAt: new Date().toISOString(), lastHash: hash, lastError: undefined };
      await this.garden.saveSettings({ lastBackupAt: this.settings.lastSavedAt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.settings = { ...s, lastError: `The automatic backup couldn't be saved (${msg}). Check the folder still exists, or choose it again.` };
    } finally {
      this.busy = false;
      await saveAutoBackup(this.local, this.settings).catch(() => undefined);
      this.emit();
    }
  }
}

/** Runs the controller for the whole app: after changes (debounced) and when the app is backgrounded. */
export function useAutoBackupRunner(controller: AutoBackupController, dataVersion: unknown) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void controller.load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') void controller.run();
    });
    return () => sub.remove();
  }, [controller]);
  useEffect(() => {
    if (!controller.settings) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void controller.run(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [controller, dataVersion]);
}

export function useAutoBackupSettings(controller: AutoBackupController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
