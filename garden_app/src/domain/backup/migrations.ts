/**
 * Backup schema migrations. Each step converts version N to N+1 and must be
 * pure and tolerant of missing optional data.
 *
 * Schema history
 *  v1 — pre-release development format:
 *       profile.location.climateZone (single field, no override/suggestion split),
 *       profile.household (number), profile.hoursPerWeek (number),
 *       planting.datePlanted, no taskResponses/observations, no checksum.
 *  v2 — planting.areaId (a single garden area).
 *  v3 — current: planting.areaIds (any number of areas); see format.ts.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function hoursToBudget(h: unknown): string {
  const n = typeof h === 'number' ? h : NaN;
  if (!Number.isFinite(n)) return '1to2';
  if (n < 1) return 'lt1';
  if (n <= 2) return '1to2';
  if (n <= 4) return '2to4';
  if (n <= 8) return '4to8';
  return '8plus';
}

function migrateV1toV2(doc: Json): Json {
  const data = isObj(doc.data) ? { ...doc.data } : {};
  if (isObj(data.profile)) {
    const p: Json = { ...data.profile };
    if (isObj(p.location)) {
      const loc: Json = { ...p.location };
      if (loc.climateZone !== undefined) {
        // v1 stored whatever zone was active; treat it as the gardener's choice.
        loc.overrideZone = loc.climateZone;
        delete loc.climateZone;
      }
      loc.source ??= 'manual';
      p.location = loc;
    }
    if (p.householdSize === undefined && typeof p.household === 'number') p.householdSize = p.household;
    delete p.household;
    if (p.timeBudget === undefined) p.timeBudget = hoursToBudget(p.hoursPerWeek);
    delete p.hoursPerWeek;
    data.profile = p;
  }
  if (Array.isArray(data.plantings)) {
    data.plantings = data.plantings.map((pl: unknown) => {
      if (!isObj(pl)) return pl;
      const n: Json = { ...pl };
      if (n.plantedDate === undefined && n.datePlanted !== undefined) n.plantedDate = n.datePlanted;
      delete n.datePlanted;
      n.dateAccuracy ??= 'exact';
      n.stageIsManual ??= false;
      n.events ??= [];
      return n;
    });
  }
  data.taskResponses ??= [];
  data.observations ??= [];
  data.journal ??= [];
  data.wishlist ??= [];
  data.successionPlans ??= [];
  data.areas ??= [];
  data.settings ??= { id: 'settings', weatherEnabled: true, hiddenPlantIds: [] };
  return { ...doc, schemaVersion: 2, data, app: doc.app ?? { name: 'Sow by Season', version: 'unknown' } };
}

function migrateV2toV3(doc: Json): Json {
  const data = isObj(doc.data) ? { ...doc.data } : {};
  if (Array.isArray(data.plantings)) {
    data.plantings = data.plantings.map((pl: unknown) => {
      if (!isObj(pl)) return pl;
      const n: Json = { ...pl };
      if (typeof n.areaId === 'string' && n.areaId && n.areaIds === undefined) n.areaIds = [n.areaId];
      delete n.areaId;
      return n;
    });
  }
  return { ...doc, schemaVersion: 3, data };
}

export const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
};

export function migrate(doc: Json, from: number, to: number): { doc: Json; applied: string[] } {
  let cur = doc;
  const applied: string[] = [];
  for (let v = from; v < to; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema ${v} to ${v + 1}`);
    cur = step(cur);
    applied.push(`v${v} → v${v + 1}`);
  }
  return { doc: cur, applied };
}
