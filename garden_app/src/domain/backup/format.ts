/**
 * Versioned backup format.
 *
 *   {
 *     "format": "sow-by-season-backup",
 *     "schemaVersion": 5,
 *     "createdAt": "2026-09-24T08:00:00.000Z",
 *     "app": { "name": "Sow by Season", "version": "1.0.0" },
 *     "catalogueVersion": "2026.09.1",
 *     "counts": { "areas": 2, "plantings": 5, ... },
 *     "checksum": "fnv1a-…",
 *     "data": { profile, settings, areas, plantings, journal, wishlist,
 *               successionPlans, taskResponses, observations, customPlants }
 *   }
 *
 * Only user-created data is included. The plant catalogue and weather are
 * recreated by the app and are deliberately not duplicated.
 */
import type { GardenData } from '../types';

export const BACKUP_FORMAT = 'sow-by-season-backup';
export const CURRENT_SCHEMA_VERSION = 5;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

export interface BackupFileV5 {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 5;
  createdAt: string;
  app: { name: string; version: string };
  catalogueVersion?: string;
  counts: Record<string, number>;
  checksum: string;
  data: GardenData;
  /**
   * Optional photo files (the gardener chooses whether to include them):
   * file name → base64 JPEG, with its own checksum so damaged photos can be
   * left out without losing the rest of the backup.
   */
  attachments?: BackupAttachments;
}

export interface BackupAttachments {
  files: Record<string, string>;
  checksum: string;
}

/** Deterministic JSON (sorted keys) so the checksum is stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** 32-bit FNV-1a — detects accidental corruption/truncation, not tampering. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`;
}

export function countsFor(data: GardenData): Record<string, number> {
  return {
    areas: data.areas.length,
    plantings: data.plantings.length,
    journal: data.journal.length,
    wishlist: data.wishlist.length,
    successionPlans: data.successionPlans.length,
    taskResponses: data.taskResponses.length,
    observations: data.observations.length,
    customPlants: data.customPlants.length,
  };
}

export function createBackup(
  data: GardenData,
  opts: { now: Date; appVersion: string; catalogueVersion?: string; photos?: Record<string, string> },
): BackupFileV5 {
  const photos = opts.photos && Object.keys(opts.photos).length ? opts.photos : undefined;
  return {
    format: BACKUP_FORMAT,
    schemaVersion: 5,
    createdAt: opts.now.toISOString(),
    app: { name: 'Sow by Season', version: opts.appVersion },
    catalogueVersion: opts.catalogueVersion,
    counts: countsFor(data),
    checksum: fnv1a(stableStringify(data)),
    data,
    ...(photos ? { attachments: { files: photos, checksum: fnv1a(stableStringify(photos)) } } : {}),
  };
}

/** e.g. SowBySeason-Backup-2026-09-24.json (local date supplied by caller). */
export function backupFileName(localDate: string): string {
  return `SowBySeason-Backup-${localDate}.json`;
}

export function serialiseBackup(b: BackupFileV5): string {
  return JSON.stringify(b, null, 2);
}
