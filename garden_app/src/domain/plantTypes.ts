/**
 * Plant catalogue data model.
 *
 * Plant records are *data*, interpreted by the domain engine. Horticultural
 * behaviour should be expressed here (production profiles, windows, tolerances)
 * rather than as `if (plant === 'carrot')` branches in code.
 *
 * Every field is optional unless it is genuinely required for the engine.
 * Missing values mean "unknown" — the engine must degrade gracefully and never
 * invent a number to fill a gap.
 */
import type { ClimateZoneId, ISODate, Month, Range, StartMethod } from './types';

export type PlantCategory =
  | 'vegetable'
  | 'herb'
  | 'fruit'
  | 'tree'
  | 'perennial'
  | 'annual'
  | 'flower'
  | 'native'
  | 'green-manure'
  | 'cover-crop'
  | 'pollinator';

export type Lifecycle = 'annual' | 'biennial' | 'perennial';

/** Botanical family — used for crop rotation and "related crops" logic. */
export type PlantFamily =
  | 'Solanaceae'
  | 'Cucurbitaceae'
  | 'Brassicaceae'
  | 'Fabaceae'
  | 'Amaryllidaceae'
  | 'Apiaceae'
  | 'Asteraceae'
  | 'Amaranthaceae'
  | 'Poaceae'
  | 'Convolvulaceae'
  | 'Lamiaceae'
  | 'Rosaceae'
  | 'Passifloraceae'
  | 'Rutaceae'
  | 'Moraceae'
  | 'Anacardiaceae'
  | 'Ericaceae'
  | 'Boraginaceae'
  | 'Aizoaceae'
  | 'Lauraceae'
  | 'Vitaceae'
  | 'Cactaceae'
  | 'Other';

/** Per-zone planting windows. Months are calendar months in that zone. */
export interface ZoneWindow {
  /** Months to sow seed (direct or in trays). */
  sow?: Month[];
  /** Months to plant non-seed material (seedlings, tubers, cloves, runners, trees). */
  plant?: Month[];
  /** Source id from the sources registry. */
  sourceId: string;
  note?: string;
}

export type ZoneWindows = Partial<Record<ClimateZoneId, ZoneWindow>>;

export type ProductionStyle =
  | 'single-harvest'
  | 'repeat-harvest'
  | 'cut-and-come-again'
  | 'long-lived';

/**
 * Household production model. These are BearyNatural *planning heuristics*
 * (not horticultural measurements) and are always presented as estimates.
 *
 *   plants per batch ≈ (householdBase + plantsPerPerson × people) × level factor
 *   capped at maxPlantsPerHousehold.
 */
export interface ProductionProfile {
  style: ProductionStyle;
  /** Plants per person per sowing batch for a "regular fresh supply" level. */
  plantsPerPerson?: Range;
  /** Fixed plants per household regardless of size (e.g. 1 lemon tree). */
  householdBase?: Range;
  /** Hard ceiling — e.g. more than 2 zucchini rarely helps a home garden. */
  maxPlantsPerHousehold?: number;
  /** Suggested days between sowings when succession planting suits the crop. */
  successionIntervalDays?: Range;
  /** Typical length of the harvest period once it begins (days). */
  harvestWindowDays?: Range;
  maintenance: 'low' | 'medium' | 'high';
  /** Unit wording for quantities, e.g. "plants", "seeds", "cloves". */
  unit?: string;
  sourceId: string;
}

export interface GerminationData {
  soilTempMinC?: number;
  soilTempOptimumC?: Range;
  soilTempMaxC?: number;
  days?: Range;
  sourceIds: string[];
}

export interface TimingData {
  /**
   * What daysToFlower/daysToMaturity are counted from. Seed catalogues
   * conventionally count transplanted crops (tomato, capsicum, brassicas…)
   * from transplanting and direct-sown crops from sowing. Defaults to 'sowing'.
   */
  basis?: 'sowing' | 'transplant';
  /** Days from sowing to transplant-ready seedling. */
  daysToTransplant?: Range;
  /** Days to first harvest / maturity (see `basis`). */
  daysToMaturity?: Range;
  /** Days to first flowers (see `basis`). */
  daysToFlower?: Range;
  /** For perennials/trees: years from planting until meaningful fruiting. */
  yearsToFirstCrop?: Range;
  /** Seasonal flowering/harvest months for established perennials, per zone where known. */
  floweringMonths?: Partial<Record<ClimateZoneId, Month[]>>;
  harvestMonths?: Partial<Record<ClimateZoneId, Month[]>>;
  sourceIds: string[];
}

export interface ClimateTolerance {
  frost: 'tender' | 'half-hardy' | 'hardy' | 'unknown';
  heat: 'low' | 'moderate' | 'high' | 'unknown';
  /** Tends to run to seed ("bolt") in hot weather. */
  boltsInHeat?: boolean;
  /** Forecast max temperature (°C) above which bolting risk is flagged. Heuristic. */
  boltRiskAboveC?: number;
  /**
   * Zones where the plant is generally worth growing. When set, zones not
   * listed are treated as "not well suited" (the gardener can still plant it).
   */
  suitableZones?: ClimateZoneId[];
  sourceIds: string[];
}

export type SunNeed = 'full-sun' | 'part-shade' | 'shade-tolerant';
export type WaterNeed = 'low' | 'moderate' | 'high';

export interface SiteNeeds {
  sun: SunNeed;
  /** Minimum direct sun hours per day for reasonable results (heuristic). */
  minSunHours?: number;
  water: WaterNeed;
  soilPh?: Range;
  soilNotes?: string;
  drainage?: 'free-draining' | 'moisture-retentive' | 'tolerates-wet';
  sourceIds: string[];
}

export interface Amendment {
  advice: string;
  reason: string;
  kind: 'add' | 'avoid';
}

export interface FeedingData {
  level: 'light' | 'moderate' | 'heavy';
  /** Days between feeds during active growth, when regular feeding is useful. */
  intervalDays?: number;
  notes?: string;
  sourceIds: string[];
}

export interface SpacingData {
  plantCm?: Range;
  rowCm?: Range;
  matureWidthCm?: Range;
  matureHeightCm?: Range;
  rootDepthCm?: Range;
  sowingDepthMm?: Range;
  sourceIds: string[];
}

export type SupportNeed = 'none' | 'optional' | 'stake' | 'trellis' | 'cage';

export interface ContainerSuitability {
  suitable: boolean | 'unknown';
  minVolumeL?: number;
  notes?: string;
}

export interface CareFlags {
  /** Direct-sown seedlings usually need thinning. */
  thin?: boolean;
  mulch?: boolean;
  /** Hilling/mounding soil around stems (potatoes). */
  hill?: boolean;
}

export type ReviewStatus = 'draft' | 'source-checked' | 'expert-reviewed';

export interface PlantRecord {
  id: string;
  commonName: string;
  botanicalName?: string;
  family?: PlantFamily;
  /** Family name to show when it isn't one of the families above (e.g. a plant the gardener added). */
  familyName?: string;
  aliases: string[];
  cultivars?: { name: string; notes?: string }[];
  categories: PlantCategory[];
  lifecycle: Lifecycle;
  summary: string;
  /** Start methods that make sense for this plant, most common first. */
  startMethods: StartMethod[];
  windows: ZoneWindows;
  germination?: GerminationData;
  timing?: TimingData;
  climate: ClimateTolerance;
  site: SiteNeeds;
  feeding?: FeedingData;
  amendments?: Amendment[];
  spacing?: SpacingData;
  support: SupportNeed;
  container: ContainerSuitability;
  care?: CareFlags;
  pruning?: string;
  problems?: string[];
  production: ProductionProfile;
  tags: string[];
  review: {
    status: ReviewStatus;
    reviewedOn: ISODate;
    notes?: string;
  };
  /**
   * Where the record came from, when not the catalogue built into the app:
   * 'update' — downloaded plant list update; 'yours' — added by the gardener.
   */
  origin?: 'update' | 'yours';
}

export interface SourceRef {
  id: string;
  title: string;
  publisher: string;
  url?: string;
  /** Date the source was consulted for this catalogue. */
  accessed: ISODate;
  kind: 'government' | 'university' | 'broadcaster' | 'horticultural-org' | 'seed-supplier' | 'industry' | 'heuristic';
  notes?: string;
}

// ---------------------------------------------------------------------------
// Allowed values at runtime (for validating plant data from outside the app)
// ---------------------------------------------------------------------------

export const PLANT_CATEGORIES: readonly PlantCategory[] = ['vegetable', 'herb', 'fruit', 'tree', 'perennial', 'annual', 'flower', 'native', 'green-manure', 'cover-crop', 'pollinator'];
export const LIFECYCLES: readonly Lifecycle[] = ['annual', 'biennial', 'perennial'];
export const PLANT_FAMILIES: readonly PlantFamily[] = [
  'Solanaceae', 'Cucurbitaceae', 'Brassicaceae', 'Fabaceae', 'Amaryllidaceae', 'Apiaceae', 'Asteraceae', 'Amaranthaceae', 'Poaceae',
  'Convolvulaceae', 'Lamiaceae', 'Rosaceae', 'Passifloraceae', 'Rutaceae', 'Moraceae', 'Anacardiaceae', 'Ericaceae', 'Boraginaceae',
  'Aizoaceae', 'Lauraceae', 'Vitaceae', 'Cactaceae', 'Other',
];
export const SUN_NEEDS: readonly SunNeed[] = ['full-sun', 'part-shade', 'shade-tolerant'];
export const WATER_NEEDS: readonly WaterNeed[] = ['low', 'moderate', 'high'];
export const SUPPORT_NEEDS: readonly SupportNeed[] = ['none', 'optional', 'stake', 'trellis', 'cage'];
export const PRODUCTION_STYLES: readonly ProductionStyle[] = ['single-harvest', 'repeat-harvest', 'cut-and-come-again', 'long-lived'];
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['draft', 'source-checked', 'expert-reviewed'];
export const SOURCE_KINDS: readonly SourceRef['kind'][] = ['government', 'university', 'broadcaster', 'horticultural-org', 'seed-supplier', 'industry', 'heuristic'];
