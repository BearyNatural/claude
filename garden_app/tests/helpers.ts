/// <reference types="node" />
import { PLANTS } from '../src/data/plants';
import { createCatalogue } from '../src/domain/catalogue';
import { addDays } from '../src/domain/dates';
import type { PlantRecord } from '../src/domain/plantTypes';
import type { GardenArea, GardenProfile, ISODate, Planting } from '../src/domain/types';
import { assessWeather, type DailyForecast, type WeatherAssessment, type WeatherSnapshot } from '../src/domain/weather';

export const catalogue = createCatalogue(PLANTS);
export const getPlant = (id: string) => catalogue.byId.get(id);
export function plant(id: string): PlantRecord {
  const p = getPlant(id);
  if (!p) throw new Error(`No plant ${id}`);
  return p;
}

export const NOW_ISO = '2026-09-24T00:00:00.000Z';

export function profile(overrides: Partial<GardenProfile> = {}): GardenProfile {
  return {
    id: 'profile',
    location: {
      suburb: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
      timezone: 'Australia/Brisbane',
      approxLatitude: -27.47,
      approxLongitude: 153.03,
      suggestedZone: 'subtropical',
      suggestedFrostRisk: 'light',
      source: 'offline-list',
    },
    householdSize: 3,
    timeBudget: '1to2',
    goals: ['fresh-veg'],
    reminders: { enabled: true, gardeningDays: [6], reminderTime: '08:00', quietDays: [], mode: 'gardening-days' },
    onboardingComplete: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

let n = 0;
export function planting(overrides: Partial<Planting> & { plantId: string }): Planting {
  n++;
  return {
    id: `pl${n}`,
    quantity: 10,
    startMethod: 'direct-sow',
    plantedDate: '2026-09-01',
    dateAccuracy: 'exact',
    stage: 'seed',
    stageIsManual: false,
    events: [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

export function area(overrides: Partial<GardenArea> = {}): GardenArea {
  n++;
  return {
    id: `a${n}`,
    name: 'Back vegetable patch',
    type: 'vegetable-bed',
    lengthM: 4,
    widthM: 1,
    sunHours: 7,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

/** A weather snapshot with `days` of forecast starting at `start`. */
export function snapshot(start: ISODate, days: Partial<DailyForecast>[], opts: { fetchedAt?: string; soilC?: number } = {}): WeatherSnapshot {
  const daily = days.map((d, i) => ({ date: addDays(start, i), maxC: 26, minC: 14, precipitationMm: 0, ...d }));
  return {
    provider: 'test',
    fetchedAt: opts.fetchedAt ?? NOW_ISO,
    latitude: -27.47,
    longitude: 153.03,
    timezone: 'Australia/Brisbane',
    daily,
    soil: opts.soilC !== undefined ? { depthCm: 6, kind: 'modelled', days: daily.map((d) => ({ date: d.date, meanC: opts.soilC! })) } : undefined,
  };
}

export function mildWeather(today: ISODate, soilC?: number): WeatherAssessment {
  return assessWeather(snapshot(today, Array(7).fill({}), { soilC }), today, new Date(NOW_ISO));
}

export function noWeather(today: ISODate): WeatherAssessment {
  return assessWeather(null, today, new Date(NOW_ISO));
}
