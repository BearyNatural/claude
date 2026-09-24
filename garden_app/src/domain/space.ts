/**
 * Garden space estimates and overcrowding checks.
 *
 * The footprint model is intentionally simple and explainable:
 *   footprint per plant ≈ plant spacing × row spacing (lower ends of ranges),
 *   or mature width² for sprawling plants when that is known and larger.
 * Values are approximate; the goal is to catch obvious problems like four
 * zucchini in a 1 × 1 m bed, not to lay out a garden to the centimetre.
 */
import type { PlantRecord } from './plantTypes';
import { ACTIVE_STAGES } from './types';
import type { GardenArea, Planting } from './types';

/** Usable growing area of a garden area in m², or null when unknown. */
export function areaCapacityM2(area: GardenArea): number | null {
  if (area.usableAreaM2 && area.usableAreaM2 > 0) return area.usableAreaM2;
  if (area.lengthM && area.widthM && area.lengthM > 0 && area.widthM > 0) return area.lengthM * area.widthM;
  const c = area.container;
  if (c?.diameterCm && c.diameterCm > 0) {
    const r = c.diameterCm / 200;
    return Math.PI * r * r;
  }
  return null;
}

/** Approximate footprint of one plant in m². */
export function footprintPerPlantM2(plant: PlantRecord): number | null {
  const s = plant.spacing;
  if (!s) return null;
  const plantCm = s.plantCm?.[0];
  const rowCm = s.rowCm?.[0];
  let fp: number | null = null;
  if (plantCm && rowCm) fp = (plantCm / 100) * (rowCm / 100);
  else if (plantCm) fp = (plantCm / 100) ** 2;
  const w = s.matureWidthCm?.[0];
  if (w) {
    const byWidth = (w / 100) ** 2;
    fp = fp === null ? byWidth : Math.max(fp, byWidth);
  }
  return fp;
}

export function isActive(p: Planting): boolean {
  return ACTIVE_STAGES.includes(p.stage);
}

export interface AreaUsage {
  capacityM2: number | null;
  usedM2: number;
  /** Plantings whose footprint couldn't be estimated. */
  unknownFootprint: string[];
  freeM2: number | null;
  /** used / capacity (0..∞), or null when capacity unknown. */
  ratio: number | null;
}

export function areaUsage(area: GardenArea, plantings: readonly Planting[], getPlant: (id: string) => PlantRecord | undefined): AreaUsage {
  const capacityM2 = areaCapacityM2(area);
  let usedM2 = 0;
  const unknownFootprint: string[] = [];
  for (const p of plantings) {
    if (p.areaId !== area.id || !isActive(p)) continue;
    const plant = getPlant(p.plantId);
    const fp = plant ? footprintPerPlantM2(plant) : null;
    if (fp === null) unknownFootprint.push(p.id);
    else usedM2 += fp * p.quantity;
  }
  const freeM2 = capacityM2 === null ? null : Math.max(0, capacityM2 - usedM2);
  return { capacityM2, usedM2, unknownFootprint, freeM2, ratio: capacityM2 ? usedM2 / capacityM2 : null };
}

export interface SpaceCheck {
  fits: boolean | null;
  message?: string;
  /** Rough maximum that would fit in the remaining space. */
  maxThatFits?: number;
}

/** Would `quantity` more of `plant` fit in `area` given current plantings? */
export function checkFit(
  area: GardenArea,
  plant: PlantRecord,
  quantity: number,
  plantings: readonly Planting[],
  getPlant: (id: string) => PlantRecord | undefined,
): SpaceCheck {
  const usage = areaUsage(area, plantings, getPlant);
  const fp = footprintPerPlantM2(plant);
  if (usage.freeM2 === null || fp === null || fp <= 0) return { fits: null };
  const needed = fp * quantity;
  const maxThatFits = Math.floor(usage.freeM2 / fp + 1e-9);
  // 10% tolerance — spacing figures are generous and gardeners plant intensively.
  if (needed <= usage.freeM2 * 1.1) return { fits: true, maxThatFits };
  const name = plant.commonName.toLowerCase();
  const dims = area.lengthM && area.widthM ? `${area.lengthM} × ${area.widthM} m ` : '';
  const message =
    maxThatFits <= 0
      ? `${area.name} already looks full, so ${quantity} ${name} plants are unlikely to fit comfortably.`
      : `${quantity} ${name} plants are unlikely to fit comfortably in this ${dims}${area.type.replace('-', ' ')} — about ${maxThatFits} would suit the remaining space.`;
  return { fits: false, message, maxThatFits };
}

/** Overcrowding warnings for an area's existing plantings. */
export function overcrowdingWarning(
  area: GardenArea,
  plantings: readonly Planting[],
  getPlant: (id: string) => PlantRecord | undefined,
): string | null {
  const u = areaUsage(area, plantings, getPlant);
  if (u.ratio === null || u.ratio <= 1.2) return null;
  const pct = Math.round(u.ratio * 100);
  return `${area.name} is planted at roughly ${pct}% of its estimated capacity. Crowded plants compete for light, water and food and are more prone to disease — consider thinning or moving some.`;
}

/** Sun check for an area vs a plant's needs. */
export function sunCheck(area: GardenArea, plant: PlantRecord): string | null {
  if (area.sunHours === undefined || plant.site.minSunHours === undefined) return null;
  if (area.sunHours >= plant.site.minSunHours) return null;
  return `${plant.commonName} usually wants at least ${plant.site.minSunHours} hours of sun; ${area.name} gets about ${area.sunHours}.`;
}

/** Container check (pots/large containers). */
export function containerCheck(area: GardenArea, plant: PlantRecord): string | null {
  if (area.type !== 'pot' && area.type !== 'large-container' && area.type !== 'balcony') return null;
  if (plant.container.suitable === false) return `${plant.commonName} is not well suited to containers.`;
  const vol = area.container?.volumeL;
  if (vol !== undefined && plant.container.minVolumeL !== undefined && vol < plant.container.minVolumeL) {
    return `${plant.commonName} generally needs a container of at least ${plant.container.minVolumeL} L; ${area.name} is about ${vol} L.`;
  }
  return null;
}
