/**
 * Core domain types for Sow by Season.
 *
 * This module has NO runtime dependencies and no React / React Native imports.
 * Everything in src/domain is pure TypeScript so it can be unit-tested in Node
 * and reused by any UI (mobile, web, a future server-side tool, etc).
 */
import type { GardenSite } from './gardens';
import type { Lifecycle, PlantCategory, SunNeed, SupportNeed } from './plantTypes';

/** A local calendar date in the gardener's timezone, formatted YYYY-MM-DD. */
export type ISODate = string;
/** A full ISO-8601 timestamp including offset/Z, e.g. 2026-09-24T08:30:00.000Z. */
export type ISODateTime = string;
/** Calendar month, 1 = January … 12 = December. */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/** Inclusive numeric range [low, high]. */
export type Range = [number, number];
/** 0 = Sunday … 6 = Saturday (matches Date#getUTCDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ---------------------------------------------------------------------------
// Location & climate
// ---------------------------------------------------------------------------

export type AustralianState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';

export type ClimateZoneId =
  | 'tropical'
  | 'subtropical'
  | 'warm-temperate'
  | 'cool-temperate'
  | 'arid';

export type FrostRisk = 'none' | 'light' | 'moderate' | 'heavy' | 'unknown';

export interface GardenLocation {
  postcode?: string;
  suburb?: string;
  state?: AustralianState;
  /** IANA timezone, e.g. Australia/Brisbane. Always required: dates depend on it. */
  timezone: string;
  /**
   * Approximate coordinates, deliberately rounded (see location.ts) so we never
   * retain precise GPS. Used for weather requests and nearest-town climate inference.
   */
  approxLatitude?: number;
  approxLongitude?: number;
  suggestedZone?: ClimateZoneId;
  suggestedZoneReason?: string;
  /** Set when the gardener overrides the suggestion (microclimate etc). */
  overrideZone?: ClimateZoneId;
  suggestedFrostRisk?: FrostRisk;
  overrideFrostRisk?: FrostRisk;
  source: 'offline-list' | 'online-geocoder' | 'manual';
}

// ---------------------------------------------------------------------------
// Garden profile
// ---------------------------------------------------------------------------

export type TimeBudget = 'lt1' | '1to2' | '2to4' | '4to8' | '8plus';

export type GardeningGoal =
  | 'fresh-veg'
  | 'supplement'
  | 'maximise'
  | 'herbs'
  | 'fruit'
  | 'flowers'
  | 'pollinators'
  | 'native'
  | 'low-maintenance'
  | 'learning'
  | 'self-sufficiency';

export type ReminderMode = 'daily-summary' | 'gardening-days' | 'weekly';

export interface ReminderPreferences {
  enabled: boolean;
  /** Days the gardener prefers to garden. */
  gardeningDays: Weekday[];
  /** 24h HH:MM local time. */
  reminderTime: string;
  /** Days on which no reminders should be sent. */
  quietDays: Weekday[];
  mode: ReminderMode;
}

export interface PropertyLocation {
  lat: number;
  lon: number;
  /** The address or place as the gardener chose it, e.g. "12 Example St, Strathpine". */
  label?: string;
  /** Last map zoom level, so the map reopens where they left it. */
  zoom?: number;
}

export interface GardenProfile {
  id: 'profile';
  gardenName?: string;
  location: GardenLocation;
  /** "How many people are you hoping to grow food for?" */
  householdSize: number;
  timeBudget: TimeBudget;
  goals: GardeningGoal[];
  reminders: ReminderPreferences;
  /**
   * Optional, for the garden map only: where the property is, found from an
   * address search. Precise, so it never leaves the phone (weather and climate
   * keep using the rounded `location`). Removable at any time.
   */
  property?: PropertyLocation;
  onboardingComplete: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Garden areas
// ---------------------------------------------------------------------------

export type AreaType =
  | 'vegetable-bed'
  | 'raised-bed'
  | 'in-ground'
  | 'pot'
  | 'large-container'
  | 'greenhouse'
  | 'orchard'
  | 'food-forest'
  | 'herb-garden'
  | 'balcony'
  | 'trellis'
  | 'seed-starting';

export type SoilType = 'sandy' | 'loam' | 'clay' | 'potting-mix' | 'raised-bed-mix' | 'unknown';
export type Drainage = 'fast' | 'normal' | 'stays-wet' | 'unknown';
export type SoilObservation =
  | 'compacted'
  | 'hydrophobic'
  | 'rocky'
  | 'high-organic'
  | 'low-organic';
export type Irrigation = 'none' | 'hand' | 'drip' | 'sprinkler' | 'wicking' | 'unknown';

export interface ContainerDimensions {
  volumeL?: number;
  diameterCm?: number;
  depthCm?: number;
}

export interface GardenArea {
  id: string;
  /** Which garden it belongs to; absent = the home garden. */
  gardenId?: string;
  name: string;
  type: AreaType;
  lengthM?: number;
  widthM?: number;
  /** Overrides length × width when the gardener knows the usable planting area. */
  usableAreaM2?: number;
  sunHours?: number;
  soilType?: SoilType;
  drainage?: Drainage;
  soilObservations?: SoilObservation[];
  irrigation?: Irrigation;
  container?: ContainerDimensions;
  /** Corners traced on the satellite map (optional). Size fields are then measured from it. */
  outline?: { lat: number; lon: number }[];
  notes?: string;
  archived?: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Plantings
// ---------------------------------------------------------------------------

export type GrowthStage =
  | 'planned'
  | 'seed'
  | 'germinating'
  | 'seedling'
  | 'transplanted'
  | 'established'
  | 'flowering'
  | 'fruiting'
  | 'harvesting'
  | 'dormant'
  | 'finished'
  | 'removed'
  | 'failed';

export const ACTIVE_STAGES: readonly GrowthStage[] = [
  'seed',
  'germinating',
  'seedling',
  'transplanted',
  'established',
  'flowering',
  'fruiting',
  'harvesting',
  'dormant',
];

export type StartMethod =
  | 'direct-sow'
  | 'seed-tray'
  | 'seedling'
  | 'cutting'
  | 'tuber'
  | 'clove-or-bulb'
  | 'runner-or-crown'
  | 'tree';

export type DateAccuracy = 'exact' | 'approx-week' | 'approx-month';

export type PlantingEventType =
  | 'sown'
  | 'planted'
  | 'germinated'
  | 'transplanted'
  | 'first-flower'
  | 'fruit-set'
  | 'first-harvest'
  | 'harvest'
  | 'finished'
  | 'removed'
  | 'failed'
  | 'stage-change';

export interface PlantingEvent {
  id: string;
  type: PlantingEventType;
  date: ISODate;
  stage?: GrowthStage;
  note?: string;
}

export interface Planting {
  id: string;
  /** Which garden it belongs to; absent = the home garden. */
  gardenId?: string;
  plantId: string;
  variety?: string;
  quantity: number;
  /**
   * Garden areas this planting is in (none = no particular area). Several areas
   * share the quantity evenly, e.g. marigolds spread through three beds.
   * Replaces the single `areaId` of schema v2 (converted when read).
   */
  areaIds?: string[];
  startMethod: StartMethod;
  /** Date sown/planted (or planned). */
  plantedDate: ISODate;
  dateAccuracy: DateAccuracy;
  stage: GrowthStage;
  /** True when the gardener set the stage explicitly (don't auto-estimate). */
  stageIsManual: boolean;
  events: PlantingEvent[];
  successionPlanId?: string;
  /** Set when this planting is part of a structured planting system (e.g. Three Sisters). */
  system?: { planId: string; systemId: string; role: string };
  notes?: string;
  /** Photos kept with this planting (files stored in the app's own storage on this device). */
  photos?: PlantingPhoto[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PlantingPhoto {
  id: string;
  /** File name inside the app's photos folder, e.g. "ph_abc123.jpg". */
  file: string;
  takenAt: ISODateTime;
  caption?: string;
}

export interface JournalEntry {
  id: string;
  /** Which garden it belongs to; absent = the home garden. */
  gardenId?: string;
  date: ISODate;
  text: string;
  plantingId?: string;
  areaId?: string;
  createdAt: ISODateTime;
}

export interface WishListItem {
  id: string;
  plantId: string;
  note?: string;
  addedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Succession planting
// ---------------------------------------------------------------------------

export type SuccessionBatchStatus = 'planned' | 'accepted' | 'skipped';

export interface SuccessionBatch {
  index: number;
  plannedDate: ISODate;
  quantity: number;
  status: SuccessionBatchStatus;
  plantingId?: string;
  /** True when the gardener edited this batch's quantity. */
  quantityIsManual?: boolean;
}

export interface SuccessionPlan {
  id: string;
  /** Which garden it belongs to; absent = the home garden. */
  gardenId?: string;
  plantId: string;
  areaId?: string;
  intervalDays: number;
  defaultBatchQuantity: number;
  status: 'active' | 'stopped' | 'completed';
  batches: SuccessionBatch[];
  /** Explanatory notes produced when the plan was (re)calculated. */
  notes: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Tasks & reminders
// ---------------------------------------------------------------------------

export type TaskKind =
  | 'sow'
  | 'succession-sow'
  | 'transplant'
  | 'thin'
  | 'water'
  | 'feed'
  | 'mulch'
  | 'stake'
  | 'hill'
  | 'prune'
  | 'harvest'
  | 'frost-protect'
  | 'heat-protect'
  | 'rain-check'
  | 'inspect'
  | 'prepare-bed'
  | 'buy-seed'
  | 'system-step';

export type TaskSection = 'plant' | 'harvest' | 'care' | 'protect' | 'prepare';
export type TaskPriority = 'important' | 'soon' | 'optional';

export interface GardenTask {
  /** Deterministic id so user responses (done/skip/snooze) survive regeneration. */
  id: string;
  kind: TaskKind;
  section: TaskSection;
  priority: TaskPriority;
  title: string;
  /** Short lower-case phrase for summaries, e.g. "feed tomatoes". */
  short?: string;
  detail?: string;
  /** Why the app suggests this, in plain language. */
  why: string;
  dueDate: ISODate;
  /** Estimated minutes of work — a rough planning figure. */
  minutes: number;
  plantingId?: string;
  areaId?: string;
  plantId?: string;
  successionPlanId?: string;
  successionBatchIndex?: number;
  /** Weather-driven tasks shouldn't be deferred to a later gardening day. */
  timeCritical?: boolean;
}

export type TaskResponseStatus = 'done' | 'skipped' | 'snoozed' | 'irrelevant';

export interface TaskResponse {
  taskId: string;
  status: TaskResponseStatus;
  /** For snoozed tasks: hide until this date (inclusive of the date it reappears). */
  until?: ISODate;
  at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Observations (manual now; designed for future IoT sensors)
// ---------------------------------------------------------------------------

export type ObservationKind =
  | 'soil-moisture'
  | 'soil-temperature'
  | 'air-temperature'
  | 'rainfall'
  | 'humidity'
  | 'tank-level'
  | 'harvest-weight';

export interface Observation {
  id: string;
  /** Which garden it belongs to; absent = the home garden. */
  gardenId?: string;
  kind: ObservationKind;
  value: number;
  unit: string;
  at: ISODateTime;
  source: 'manual' | 'sensor' | 'weather-service';
  deviceId?: string;
  areaId?: string;
  plantingId?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  id: 'settings';
  weatherEnabled: boolean;
  lastBackupAt?: ISODateTime;
  /** Plant IDs the gardener has hidden from recommendations. */
  hiddenPlantIds: string[];
  /** Download plant list updates between app releases (default on). */
  plantListUpdates?: boolean;
  /** The garden currently shown when there are several (absent = home). */
  activeGardenId?: string;
  /** Android: check the forecast in the background and alert about frost, heat or heavy rain (default off). */
  backgroundAlerts?: boolean;
  /** Include plant photos in backups by default (default on). Also used for automatic backup. */
  backupPhotos?: boolean;
  /** Share plants the gardener adds with the plant list, as the starting choice for each new plant (default off — opt-in). */
  sharePlants?: boolean;
  /** Android: how often to look for a new version of the app (default daily). */
  updateChecks?: 'daily' | 'weekly';
}

/**
 * A plant the gardener added because it isn't in the catalogue. Everything
 * except the name is optional; blanks mean "unknown", never a guess.
 */
export interface CustomPlant {
  /** Always starts with "custom_" so it can never clash with catalogue ids. */
  id: string;
  commonName: string;
  botanicalName?: string;
  /** Family name as given (e.g. from the Atlas of Living Australia). */
  familyName?: string;
  /** Atlas of Living Australia taxon link, when the name was looked up there. */
  alaGuid?: string;
  categories: PlantCategory[];
  /** Absent = the gardener isn't sure (schema v7; always set before). */
  lifecycle?: Lifecycle;
  startMethods: StartMethod[];
  /** Months the gardener plants or sows it in their own garden. */
  plantMonths?: Month[];
  sun?: SunNeed;
  frost?: 'tender' | 'half-hardy' | 'hardy';
  support?: SupportNeed;
  potOk?: boolean;
  notes?: string;
  /**
   * Sharing with the Sow by Season plant list (opt-in per plant). Only the
   * plant's details, notes and climate zone are sent — never photos, the
   * garden's location or anything about the gardener.
   */
  share?: PlantShare;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PlantShare {
  /** 'pending' = the gardener chose to share; not sent yet (e.g. offline). */
  status: 'pending' | 'shared';
  sharedAt?: ISODateTime;
  /** Suggestion number in the plant list inbox, once received. */
  ref?: number;
  /** Why the last attempt to send a pending share failed, in plain words. */
  lastError?: string;
}

/** Everything the gardener created — the unit of backup/restore. */
export interface GardenData {
  profile: GardenProfile | null;
  settings: AppSettings;
  areas: GardenArea[];
  plantings: Planting[];
  journal: JournalEntry[];
  wishlist: WishListItem[];
  successionPlans: SuccessionPlan[];
  taskResponses: TaskResponse[];
  observations: Observation[];
  customPlants: CustomPlant[];
  /** Gardens besides the home garden (whose location is in the profile). */
  gardens: GardenSite[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  weatherEnabled: true,
  hiddenPlantIds: [],
};

export function emptyGardenData(): GardenData {
  return {
    profile: null,
    settings: { ...DEFAULT_SETTINGS, hiddenPlantIds: [] },
    areas: [],
    plantings: [],
    journal: [],
    wishlist: [],
    successionPlans: [],
    taskResponses: [],
    observations: [],
    customPlants: [],
    gardens: [],
  };
}
