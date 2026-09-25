/**
 * Which garden areas a planting is in. A planting can be in no particular
 * area, one area, or spread across several (its quantity is then shared
 * evenly between them for space estimates).
 */
import type { GardenArea, Planting } from './types';

export function areaIdsOf(p: Pick<Planting, 'areaIds'>): string[] {
  return p.areaIds ?? [];
}

export function isInArea(p: Pick<Planting, 'areaIds'>, areaId: string): boolean {
  return areaIdsOf(p).includes(areaId);
}

/** The first area — used where only one link fits (journal notes, task links). */
export function primaryAreaId(p: Pick<Planting, 'areaIds'>): string | undefined {
  return areaIdsOf(p)[0];
}

/** Plants of this planting counted against one of its areas. */
export function quantityInArea(p: Pick<Planting, 'areaIds' | 'quantity'>, areaId: string): number {
  const ids = areaIdsOf(p);
  return ids.includes(areaId) ? p.quantity / ids.length : 0;
}

/** Normalise a selection for saving: unique ids, none → undefined. */
export function toAreaIds(ids: readonly string[] | undefined): string[] | undefined {
  const unique = [...new Set(ids ?? [])];
  return unique.length ? unique : undefined;
}

/** "Squash bed", "Squash bed and Pots", "A, B and C" — names of the areas that still exist. */
export function areaNames(p: Pick<Planting, 'areaIds'>, areas: readonly GardenArea[]): string {
  const names = areaIdsOf(p)
    .map((id) => areas.find((a) => a.id === id)?.name)
    .filter((n): n is string => !!n);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Rosemary pot", or "Rosemary pot 2" if that name is taken. */
export function newPotName(plantName: string, areas: readonly GardenArea[]): string {
  const base = `${plantName} pot`;
  const taken = new Set(areas.map((a) => a.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
