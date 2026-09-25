/**
 * Several gardens — for example home plus a community garden plot or a
 * relative's place — each with its own location (so its own climate zone and
 * weather), areas, plantings, notes and plans.
 *
 * The first garden is the one in the Garden Profile ("home"); records without
 * a gardenId belong to it, so data from before multiple gardens needs no
 * change. The wish list and the gardener's own plants are shared by all gardens.
 */
import type { GardenData, GardenLocation, PropertyLocation } from './types';

export const HOME_GARDEN = 'home';

export interface GardenSite {
  id: string;
  name: string;
  location: GardenLocation;
  /** Optional precise location for this garden's map (stays on the device). */
  property?: PropertyLocation;
  createdAt: string;
  updatedAt: string;
}

/** A garden as the app shows it: home (from the profile) or one of the extra gardens. */
export interface ActiveGarden {
  id: string;
  name: string;
  location: GardenLocation;
  property?: PropertyLocation;
  isHome: boolean;
}

export function gardenIdOf(record: { gardenId?: string }): string {
  return record.gardenId ?? HOME_GARDEN;
}

export function homeGardenName(data: Pick<GardenData, 'profile'>): string {
  return data.profile?.gardenName?.trim() || 'Home garden';
}

/** Every garden, home first. */
export function allGardens(data: Pick<GardenData, 'profile' | 'gardens'>): ActiveGarden[] {
  const out: ActiveGarden[] = [];
  if (data.profile) out.push({ id: HOME_GARDEN, name: homeGardenName(data), location: data.profile.location, property: data.profile.property, isHome: true });
  for (const g of data.gardens) out.push({ id: g.id, name: g.name, location: g.location, property: g.property, isHome: false });
  return out;
}

/** The garden currently shown (falls back to home if the chosen one no longer exists). */
export function activeGarden(data: Pick<GardenData, 'profile' | 'gardens' | 'settings'>): ActiveGarden | null {
  const gardens = allGardens(data);
  return gardens.find((g) => g.id === (data.settings.activeGardenId ?? HOME_GARDEN)) ?? gardens[0] ?? null;
}

/**
 * The garden data as seen from one garden: its own areas, plantings, notes,
 * plans and observations; shared things (profile, settings, wish list, own
 * plants, task responses) as they are.
 */
export function scopeToGarden(data: GardenData, gardenId: string): GardenData {
  const mine = <T extends { gardenId?: string }>(xs: T[]) => xs.filter((x) => gardenIdOf(x) === gardenId);
  return {
    ...data,
    areas: mine(data.areas),
    plantings: mine(data.plantings),
    journal: mine(data.journal),
    successionPlans: mine(data.successionPlans),
    observations: mine(data.observations),
  };
}

/** How much a garden holds — a garden can only be removed once it's empty. */
export function gardenContents(data: GardenData, gardenId: string): { areas: number; plantings: number; notes: number; plans: number } {
  const s = scopeToGarden(data, gardenId);
  return { areas: s.areas.length, plantings: s.plantings.length, notes: s.journal.length, plans: s.successionPlans.length };
}
