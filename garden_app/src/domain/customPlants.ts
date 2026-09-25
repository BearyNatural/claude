/**
 * Plants the gardener adds themselves. They are turned into ordinary plant
 * records so every screen (plant page, planting, tasks, search) works with
 * them. Only what the gardener entered is used — gaps stay "unknown".
 */
import { ZONE_IDS } from './climate';
import { PLANT_FAMILIES, type PlantFamily, type PlantRecord, type ZoneWindows } from './plantTypes';
import type { CustomPlant } from './types';

export const CUSTOM_PREFIX = 'custom_';
/** Source id for anything the gardener typed in themselves. */
export const YOUR_NOTES = 'your-notes';

export function isCustomPlantId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

/** A family name the rotation logic knows, or 'Other'. */
export function knownFamily(name: string | undefined): PlantFamily | undefined {
  if (!name) return undefined;
  const hit = PLANT_FAMILIES.find((f) => f.toLowerCase() === name.trim().toLowerCase());
  return hit ?? 'Other';
}

export function customToPlantRecord(c: CustomPlant): PlantRecord {
  const windows: ZoneWindows = {};
  if (c.plantMonths?.length) {
    // The gardener's own months for their own garden: offered in every zone, so
    // they apply wherever the profile is set, and labelled as their notes.
    const seed = c.startMethods.length > 0 && c.startMethods.every((m) => m === 'direct-sow' || m === 'seed-tray');
    for (const z of ZONE_IDS) windows[z] = { ...(seed ? { sow: c.plantMonths } : { plant: c.plantMonths }), sourceId: YOUR_NOTES, note: 'Months you entered.' };
  }
  // Unknown lifecycle is treated like a perennial (one plant, no batches) — the gentlest assumption.
  const lifecycle = c.lifecycle ?? 'perennial';
  const perennial = lifecycle === 'perennial';
  return {
    id: c.id,
    commonName: c.commonName,
    botanicalName: c.botanicalName,
    family: knownFamily(c.familyName),
    familyName: c.familyName,
    aliases: [],
    categories: c.categories.length ? c.categories : ['perennial'],
    lifecycle,
    summary: c.notes?.trim() || 'No notes yet. Anything left blank when adding this plant is treated as unknown.',
    startMethods: c.startMethods.length ? c.startMethods : ['seedling'],
    windows,
    climate: { frost: c.frost ?? 'unknown', heat: 'unknown', sourceIds: [YOUR_NOTES] },
    site: { sun: c.sun ?? 'full-sun', water: 'moderate', sourceIds: [YOUR_NOTES] },
    support: c.support ?? 'none',
    container: { suitable: c.potOk ?? 'unknown' },
    production: {
      style: perennial ? 'long-lived' : 'repeat-harvest',
      householdBase: [1, 1],
      maintenance: 'medium',
      unit: c.categories.includes('tree') ? 'trees' : 'plants',
      sourceId: YOUR_NOTES,
    },
    tags: ['yours', ...(c.potOk ? ['pots'] : []), ...(c.categories.includes('tree') && c.categories.includes('fruit') ? ['fruit-tree'] : [])],
    review: { status: 'draft', reviewedOn: c.updatedAt.slice(0, 10), notes: `Added by you${c.alaGuid ? '; name from the Atlas of Living Australia' : ''}.` },
    origin: 'yours',
  };
}
