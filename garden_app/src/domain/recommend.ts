/**
 * "What can I plant now?" — the recommendation engine.
 *
 * Seasonal windows for the gardener's climate zone form the base. Local frost
 * exposure, the forecast, modelled soil temperature, the existing garden,
 * available space and sun, goals, time and the wish list then refine the
 * category and — importantly — the explanation. Every recommendation carries
 * the reasons behind it so the app never shows a bare green/red light.
 */
import { CLIMATE_ZONES } from './climate';
import { describeOffset, diffDays, formatDay, monthName, monthOf } from './dates';
import type { PlantRecord } from './plantTypes';
import { estimateQuantity, productionLevelFromGoals, type QuantityEstimate } from './production';
import { areaCapacityM2, checkFit, isActive } from './space';
import { isSuccessionSuited, chooseInterval } from './succession';
import type {
  ClimateZoneId,
  FrostRisk,
  GardenArea,
  GardeningGoal,
  ISODate,
  Planting,
  StartMethod,
  TimeBudget,
} from './types';
import type { WeatherAssessment } from './weather';
import { describeMonths, primaryWindow, windowPosition, type WindowKind } from './windows';

export type RecCategory = 'great' | 'can' | 'soon' | 'wait' | 'outside' | 'unknown';

export const CATEGORY_ORDER: RecCategory[] = ['great', 'can', 'soon', 'wait', 'outside', 'unknown'];

export const CATEGORY_LABELS: Record<RecCategory, string> = {
  great: 'Great time to plant',
  can: 'Can plant now',
  soon: 'Plant soon',
  wait: 'Better to wait',
  outside: 'Outside recommended season',
  unknown: 'No local planting information yet',
};

export type ReasonKind = 'season' | 'climate' | 'frost' | 'heat' | 'rain' | 'soil' | 'garden' | 'space' | 'sun' | 'goal' | 'time' | 'data';
export type ReasonTone = 'positive' | 'neutral' | 'caution';

export interface Reason {
  kind: ReasonKind;
  tone: ReasonTone;
  text: string;
}

export interface RecommendContext {
  today: ISODate;
  zone: ClimateZoneId | null;
  frostRisk: FrostRisk;
  weather: WeatherAssessment;
  goals: GardeningGoal[];
  timeBudget: TimeBudget;
  householdSize: number;
  plantings: Planting[];
  areas: GardenArea[];
  wishlistPlantIds: ReadonlySet<string>;
  getPlant: (id: string) => PlantRecord | undefined;
}

export interface Recommendation {
  plant: PlantRecord;
  category: RecCategory;
  headline: string;
  reasons: Reason[];
  windowKind?: WindowKind;
  windowText?: string;
  suggestedMethod: StartMethod;
  quantity?: QuantityEstimate;
  onWishlist: boolean;
  activePlantings: number;
  successionDue: boolean;
  score: number;
}

const DEMOTE: Record<RecCategory, RecCategory> = {
  great: 'can',
  can: 'can',
  soon: 'soon',
  wait: 'wait',
  outside: 'outside',
  unknown: 'unknown',
};

const WINTER_MONTHS = new Set([6, 7, 8]);

function lastSowingDate(plantings: Planting[], plantId: string): ISODate | null {
  let last: ISODate | null = null;
  for (const p of plantings) {
    if (p.plantId !== plantId || p.stage === 'planned') continue;
    if (!last || p.plantedDate > last) last = p.plantedDate;
  }
  return last;
}

function goalReasons(plant: PlantRecord, ctx: RecommendContext): { reasons: Reason[]; bonus: number } {
  const reasons: Reason[] = [];
  let bonus = 0;
  const has = (g: GardeningGoal) => ctx.goals.includes(g);
  const cats = plant.categories;
  const edible = cats.includes('vegetable') || cats.includes('herb') || cats.includes('fruit');
  const add = (text: string, pts = 8) => {
    reasons.push({ kind: 'goal', tone: 'positive', text });
    bonus += pts;
  };
  if (has('herbs') && cats.includes('herb')) add('Matches your goal of growing herbs.');
  if (has('fruit') && cats.includes('fruit')) add('Matches your goal of growing fruit.');
  if (has('flowers') && cats.includes('flower')) add('Matches your goal of growing flowers.');
  if (has('pollinators') && (cats.includes('pollinator') || plant.tags.includes('pollinator'))) add('Good for pollinators, which you said you wanted to support.');
  if (has('native') && cats.includes('native')) add('An Australian native, in line with your goals.');
  if ((has('fresh-veg') || has('supplement') || has('maximise') || has('self-sufficiency')) && edible && !cats.includes('flower')) {
    bonus += 4;
  }
  if (has('low-maintenance')) {
    if (plant.production.maintenance === 'low') add('Low maintenance, which suits your goals.', 6);
    else if (plant.production.maintenance === 'high') {
      reasons.push({ kind: 'time', tone: 'caution', text: 'Needs regular attention (staking, feeding, watering) — more work than a low-maintenance garden.' });
      bonus -= 10;
    }
  }
  if ((ctx.timeBudget === 'lt1' || ctx.timeBudget === '1to2') && plant.production.maintenance === 'high' && !has('low-maintenance')) {
    reasons.push({ kind: 'time', tone: 'caution', text: 'A higher-maintenance crop for the time you have — keep the planting small.' });
    bonus -= 6;
  }
  return { reasons, bonus };
}

function frostWord(f: FrostRisk): string {
  return f === 'heavy' ? 'heavy frosts' : f === 'moderate' ? 'frosts' : 'occasional light frosts';
}

export function recommendPlant(plant: PlantRecord, ctx: RecommendContext): Recommendation {
  const reasons: Reason[] = [];
  const onWishlist = ctx.wishlistPlantIds.has(plant.id);
  const active = ctx.plantings.filter((p) => p.plantId === plant.id && isActive(p));
  let suggestedMethod: StartMethod = plant.startMethods[0];
  let category: RecCategory;
  let windowKind: WindowKind | undefined;
  let windowText: string | undefined;
  const zone = ctx.zone;
  const zoneName = zone ? CLIMATE_ZONES[zone].name.toLowerCase() : '';

  // 1. Seasonal base -----------------------------------------------------
  if (!zone) {
    category = 'unknown';
    reasons.push({ kind: 'data', tone: 'neutral', text: 'Set your location or climate zone to get local planting times.' });
  } else if (plant.climate.suitableZones && !plant.climate.suitableZones.includes(zone)) {
    category = 'outside';
    reasons.push({ kind: 'climate', tone: 'caution', text: `Not generally suited to ${zoneName} climates. A sheltered microclimate may still work.` });
  } else {
    const win = primaryWindow(plant, zone);
    if (!win) {
      category = 'unknown';
      reasons.push({
        kind: 'data',
        tone: 'neutral',
        text: `We don't have a sourced planting window for ${plant.commonName.toLowerCase()} in ${zoneName} areas yet. You can still plant it — local nurseries are a good guide.`,
      });
    } else {
      windowKind = win.kind;
      windowText = describeMonths(win.months);
      const verb = win.kind === 'sow' ? 'sowing' : 'planting';
      const pos = windowPosition(win.months, ctx.today);
      if (pos.inWindow) {
        if (pos.allYear) {
          category = 'great';
          reasons.push({ kind: 'season', tone: 'positive', text: `Can be ${win.kind === 'sow' ? 'sown' : 'planted'} year-round in ${zoneName} areas.` });
        } else if (pos.phase === 'closing' && (pos.daysUntilClose ?? 99) < 21) {
          category = 'can';
          reasons.push({ kind: 'season', tone: 'neutral', text: `The recommended ${verb} period (${windowText}) ends soon — plant in the next couple of weeks if you want to.` });
        } else {
          category = 'great';
          reasons.push({ kind: 'season', tone: 'positive', text: `Within the recommended ${verb} period for ${zoneName} areas (${windowText}).` });
        }
      } else if (pos.daysUntilOpen !== undefined && pos.daysUntilOpen <= 42) {
        category = 'soon';
        reasons.push({ kind: 'season', tone: 'neutral', text: `The recommended ${verb} period starts ${describeOffset(pos.daysUntilOpen)} (${monthName(monthOf(pos.opensOn!))}).` });
      } else {
        category = 'outside';
        reasons.push({ kind: 'season', tone: 'neutral', text: `Recommended ${verb} period in your area: ${windowText}.` });
      }
    }
  }
  const inPlayable = category === 'great' || category === 'can';

  // 2. Local frost climate (works offline) -------------------------------
  if (inPlayable && plant.climate.frost === 'tender' && WINTER_MONTHS.has(monthOf(ctx.today)) && (ctx.frostRisk === 'moderate' || ctx.frostRisk === 'heavy')) {
    category = 'wait';
    reasons.push({ kind: 'frost', tone: 'caution', text: `Your area typically gets ${frostWord(ctx.frostRisk)} in winter and ${plant.commonName.toLowerCase()} is frost-tender. It's safer to plant after your last frost, or grow it under cover.` });
  }

  // 3. Forecast refinements ----------------------------------------------
  const w = ctx.weather;
  const caveat = w.caveat && !w.seasonalOnly ? ` (${w.caveat})` : '';
  let weatherIssue = false;
  if (!w.seasonalOnly && (category === 'great' || category === 'can' || category === 'soon')) {
    if (plant.climate.frost !== 'hardy' && w.frostDays.length > 0) {
      const d = w.frostDays[0];
      const low = w.upcoming.find((x) => x.date === d)?.minC;
      category = category === 'soon' ? 'soon' : 'wait';
      weatherIssue = true;
      reasons.push({ kind: 'frost', tone: 'caution', text: `Frost is possible around ${formatDay(d)} (forecast low ${low}°C). Wait until it passes or be ready to protect young plants.${caveat}` });
    }
    if (plant.climate.boltsInHeat && plant.climate.boltRiskAboveC !== undefined && w.maxNext7C !== undefined && w.maxNext7C >= plant.climate.boltRiskAboveC) {
      if (category === 'great' || category === 'can') category = 'wait';
      weatherIssue = true;
      reasons.push({ kind: 'heat', tone: 'caution', text: `Forecast temperatures up to ${Math.round(w.maxNext7C)}°C increase the likelihood of ${plant.commonName.toLowerCase()} bolting (running to seed). Consider waiting for milder weather or sowing in afternoon shade.${caveat}` });
    }
    const heatSoon = w.heatDays.filter((d) => diffDays(ctx.today, d) <= 3);
    if (heatSoon.length > 0 && (category === 'great' || category === 'can')) {
      const hot = Math.round(w.upcoming.find((x) => x.date === heatSoon[0])?.maxC ?? w.maxNext7C ?? 35);
      weatherIssue = true;
      if (plant.climate.heat === 'high') {
        // Heat-loving crops only need a practical note, not a downgrade.
        reasons.push({ kind: 'heat', tone: 'neutral', text: `A hot day (${hot}°C) is forecast ${describeOffset(diffDays(ctx.today, heatSoon[0]))} — water new plantings well.${caveat}` });
      } else {
        category = DEMOTE[category];
        reasons.push({ kind: 'heat', tone: 'caution', text: `Very hot weather (${hot}°C) is forecast ${describeOffset(diffDays(ctx.today, heatSoon[0]))}. Sow or transplant after the heat, or give shade and water well.${caveat}` });
      }
    }
    const soonRain = w.heavyRainDays.filter((d) => diffDays(ctx.today, d) <= 2);
    if (soonRain.length > 0 && suggestedMethod === 'direct-sow' && (category === 'great' || category === 'can')) {
      category = DEMOTE[category];
      weatherIssue = true;
      const mm = w.upcoming.find((x) => x.date === soonRain[0])?.precipitationMm;
      reasons.push({ kind: 'rain', tone: 'caution', text: `Heavy rain (about ${Math.round(mm ?? 25)} mm) is forecast ${describeOffset(diffDays(ctx.today, soonRain[0]))}. Small seeds can wash away — consider sowing after it.${caveat}` });
    }
    if (!weatherIssue && (category === 'great' || category === 'can')) {
      const tender = plant.climate.frost === 'tender';
      reasons.push({
        kind: 'frost',
        tone: 'positive',
        text: tender
          ? `Your local temperatures look suitable and no frost is forecast over the next week.${caveat}`
          : `No frost, extreme heat or heavy rain in the forecast for the coming week.${caveat}`,
      });
    }
  } else if (w.seasonalOnly && (category === 'great' || category === 'can' || category === 'soon')) {
    reasons.push({ kind: 'data', tone: 'neutral', text: 'Live weather is unavailable, so this is based on seasonal timing only.' });
  }

  // 4. Soil temperature (seed sown in the ground) -------------------------
  const g = plant.germination;
  const sowsDirect = plant.startMethods.includes('direct-sow');
  if (sowsDirect && g?.soilTempMinC !== undefined && (category === 'great' || category === 'can' || category === 'soon')) {
    if (w.soilTempC !== undefined) {
      const label = w.soilTempKind === 'measured' ? 'Measured' : 'Modelled';
      const t = w.soilTempC;
      if (t < g.soilTempMinC) {
        if (category !== 'soon') category = 'wait';
        const tray = plant.startMethods.includes('seed-tray');
        if (tray) suggestedMethod = 'seed-tray';
        reasons.push({
          kind: 'soil',
          tone: 'caution',
          text: `${label} soil temperature (${t}°C) is below the roughly ${g.soilTempMinC}°C seed needs to germinate reliably.${tray ? ' You could start seeds in trays somewhere warm instead.' : ''}`,
        });
      } else if (g.soilTempMaxC !== undefined && t > g.soilTempMaxC) {
        if (category !== 'soon') category = 'wait';
        reasons.push({ kind: 'soil', tone: 'caution', text: `${label} soil temperature (${t}°C) is above the range where seed germinates well (up to about ${g.soilTempMaxC}°C).` });
      } else if (g.soilTempOptimumC && t >= g.soilTempOptimumC[0] && t <= g.soilTempOptimumC[1]) {
        reasons.push({ kind: 'soil', tone: 'positive', text: `${label} soil temperature (${t}°C) is in a good range for germination (about ${g.soilTempOptimumC[0]}–${g.soilTempOptimumC[1]}°C).` });
      } else {
        reasons.push({ kind: 'soil', tone: 'neutral', text: `${label} soil temperature (${t}°C) is warm enough, though germination may be slower than ideal.` });
      }
    } else if (!w.seasonalOnly) {
      reasons.push({ kind: 'soil', tone: 'neutral', text: 'Soil temperature isn\'t available for your area, so germination advice uses seasonal timing.' });
    }
  }

  // 5. Existing garden, space and sun ------------------------------------
  let successionDue = false;
  let bonus = 0;
  if (active.length > 0) {
    const last = lastSowingDate(ctx.plantings, plant.id);
    if (isSuccessionSuited(plant) && last) {
      const since = diffDays(last, ctx.today);
      const interval = chooseInterval(plant, productionLevelFromGoals(ctx.goals), ctx.timeBudget);
      if (since >= interval && (category === 'great' || category === 'can')) {
        successionDue = true;
        bonus += 20;
        reasons.push({ kind: 'garden', tone: 'positive', text: `Your last sowing was ${since} days ago — a good time for the next small batch.` });
      } else if (since < interval) {
        bonus -= 15;
        reasons.push({ kind: 'garden', tone: 'neutral', text: `You sowed some ${since === 0 ? 'today' : `${since} days ago`}; the next batch would be due in about ${interval - since} days.` });
      }
    } else if (plant.production.style === 'long-lived' || !isSuccessionSuited(plant)) {
      bonus -= 25;
      reasons.push({ kind: 'garden', tone: 'neutral', text: `Already growing in your garden (${active.reduce((s, p) => s + p.quantity, 0)}).` });
    }
  }
  const quantity = plant.categories.some((c) => c === 'vegetable' || c === 'herb' || c === 'fruit')
    ? estimateQuantity(plant, { householdSize: ctx.householdSize, level: productionLevelFromGoals(ctx.goals), timeBudget: ctx.timeBudget })
    : undefined;
  const measurable = ctx.areas.filter((a) => !a.archived && areaCapacityM2(a) !== null);
  if (measurable.length > 0 && (category === 'great' || category === 'can' || category === 'soon')) {
    const want = quantity?.range[0] ?? 1;
    const anyFits = measurable.some((a) => checkFit(a, plant, want, ctx.plantings, ctx.getPlant).fits !== false);
    if (!anyFits) {
      bonus -= 15;
      reasons.push({ kind: 'space', tone: 'caution', text: 'Your garden areas look fairly full — you may need to free up space first.' });
    }
  }
  const sunKnown = ctx.areas.filter((a) => !a.archived && a.sunHours !== undefined);
  if (sunKnown.length > 0 && plant.site.minSunHours !== undefined && sunKnown.every((a) => (a.sunHours ?? 0) < plant.site.minSunHours!)) {
    bonus -= 10;
    reasons.push({ kind: 'sun', tone: 'caution', text: `Usually wants at least ${plant.site.minSunHours} hours of sun; your recorded areas get less.` });
  }

  // 6. Goals, wish list, time -------------------------------------------
  const gr = goalReasons(plant, ctx);
  reasons.push(...gr.reasons);
  bonus += gr.bonus;
  if (onWishlist) {
    bonus += 15;
    reasons.push({ kind: 'goal', tone: 'positive', text: 'On your wish list.' });
  }

  const base: Record<RecCategory, number> = { great: 100, can: 70, soon: 45, wait: 30, outside: 5, unknown: 10 };
  const verb = windowKind === 'plant' ? 'plant' : 'sow';
  const headlines: Record<RecCategory, string> = {
    great: successionDue ? 'Time for the next sowing' : `Good time to ${verb}`,
    can: `Can ${verb} now`,
    soon: `${verb === 'sow' ? 'Sow' : 'Plant'} soon`,
    wait: 'Consider waiting',
    outside: 'Outside recommended season',
    unknown: 'No local timing data yet',
  };
  return {
    plant,
    category,
    headline: headlines[category],
    reasons,
    windowKind,
    windowText,
    suggestedMethod,
    quantity,
    onWishlist,
    activePlantings: active.length,
    successionDue,
    score: base[category] + bonus,
  };
}

export interface PlantNowGroups {
  groups: { category: RecCategory; label: string; items: Recommendation[] }[];
  weatherNote?: string;
}

export function buildPlantNow(plants: readonly PlantRecord[], ctx: RecommendContext, hiddenIds: ReadonlySet<string> = new Set()): PlantNowGroups {
  const recs = plants.filter((p) => !hiddenIds.has(p.id)).map((p) => recommendPlant(p, ctx));
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: recs.filter((r) => r.category === category).sort((a, b) => b.score - a.score || a.plant.commonName.localeCompare(b.plant.commonName)),
  })).filter((g) => g.items.length > 0);
  return { groups, weatherNote: ctx.weather.caveat };
}
