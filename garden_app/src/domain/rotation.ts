/**
 * Crop rotation (first version).
 *
 * Warns when the same plant family is planted in the same area within a
 * rotation interval, because related crops share soil-borne pests and
 * diseases. Built on plant.family so a fuller rotation planner (sequences,
 * multi-year plans, green-manure breaks) can be added without changing data.
 */
import { diffDays } from './dates';
import type { PlantFamily, PlantRecord } from './plantTypes';
import { isInArea } from './plantingAreas';
import type { ISODate, Planting } from './types';

export const FAMILY_COMMON_NAMES: Partial<Record<PlantFamily, string>> = {
  Solanaceae: 'nightshade family (tomato, potato, capsicum, eggplant, chilli)',
  Cucurbitaceae: 'cucurbit family (zucchini, pumpkin, cucumber)',
  Brassicaceae: 'brassica family (cabbage, broccoli, kale, radish)',
  Fabaceae: 'legume family (beans, peas)',
  Amaryllidaceae: 'onion family (onion, garlic, leek)',
  Apiaceae: 'carrot family (carrot, parsley, coriander)',
  Amaranthaceae: 'beet family (beetroot, silverbeet, spinach)',
  Poaceae: 'grass family (corn)',
};

/** Families where rotation matters most in home gardens. */
const ROTATION_FAMILIES: PlantFamily[] = ['Solanaceae', 'Cucurbitaceae', 'Brassicaceae', 'Amaryllidaceae', 'Apiaceae', 'Amaranthaceae', 'Fabaceae', 'Poaceae'];

/** Minimum gap (days) before replanting the same family in the same spot. Heuristic. */
export const ROTATION_GAP_DAYS = 365;

export interface RotationWarning {
  family: PlantFamily;
  previous: Planting;
  message: string;
}

export function rotationWarnings(
  plant: PlantRecord,
  areaId: string | undefined,
  plantings: readonly Planting[],
  getPlant: (id: string) => PlantRecord | undefined,
  today: ISODate,
): RotationWarning[] {
  if (!areaId || !plant.family || !ROTATION_FAMILIES.includes(plant.family)) return [];
  if (plant.lifecycle === 'perennial' && plant.production.style === 'long-lived') return [];
  const out: RotationWarning[] = [];
  for (const p of plantings) {
    // Only past crops matter for rotation; plants growing together now are a companion question.
    if (!isInArea(p, areaId) || !['finished', 'removed', 'failed'].includes(p.stage)) continue;
    const other = getPlant(p.plantId);
    if (!other || other.family !== plant.family) continue;
    const since = diffDays(p.plantedDate, today);
    if (since < 0 || since > ROTATION_GAP_DAYS) continue;
    const fam = FAMILY_COMMON_NAMES[plant.family] ?? plant.family;
    out.push({
      family: plant.family,
      previous: p,
      message: `${other.commonName} (planted ${since < 45 ? 'recently' : `about ${Math.round(since / 30)} months ago`}) is in the same ${fam}. Growing related crops in the same spot repeatedly can build up soil-borne pests and diseases — consider another area if you have one.`,
    });
  }
  return out;
}
