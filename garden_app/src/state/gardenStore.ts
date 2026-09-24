/**
 * Application state container.
 *
 * Holds the loaded GardenData plus weather, and exposes *actions* that apply
 * domain rules, persist via the repository and notify subscribers. Screens
 * read state through hooks (see hooks.ts) and call actions; they never contain
 * gardening rules themselves.
 *
 * Deliberately dependency-free (no Redux/Zustand) — a tiny observable store
 * consumed with React's useSyncExternalStore.
 */
import { PLANTS } from '../data/plants';
import { THREE_SISTERS } from '../data/systems';
import { createCatalogue } from '../domain/catalogue';
import { effectiveZone } from '../domain/climate';
import { addDays, todayInTimeZone } from '../domain/dates';
import { newId } from '../domain/ids';
import { productionLevelFromGoals } from '../domain/production';
import {
  acceptBatch,
  planFromProposal,
  postponeBatch,
  proposeSuccession,
  recalculate,
  setBatchQuantity,
  skipBatch,
  stopPlan,
} from '../domain/succession';
import { planSystem } from '../domain/systems';
import {
  emptyGardenData,
  type AppSettings,
  type GardenArea,
  type GardenData,
  type GardenProfile,
  type GrowthStage,
  type ISODate,
  type JournalEntry,
  type Planting,
  type PlantingEvent,
  type PlantingEventType,
  type SuccessionPlan,
  type TaskResponseStatus,
} from '../domain/types';
import type { WeatherSnapshot } from '../domain/weather';
import type { CollectionName, GardenRepository, LoadProblem } from '../services/storage/gardenRepository';
import type { WeatherService } from '../services/weather/weatherService';

export const catalogue = createCatalogue(PLANTS);
export const getPlant = (id: string) => catalogue.byId.get(id);

export interface WeatherState {
  snapshot: WeatherSnapshot | null;
  loading: boolean;
  error?: string;
}

export interface StoreState {
  status: 'loading' | 'ready' | 'error';
  loadError?: string;
  data: GardenData;
  problems: LoadProblem[];
  weather: WeatherState;
  /** Bumped every minute-ish so "today" stays current while the app is open. */
  now: Date;
}

const EVENT_STAGE: Partial<Record<PlantingEventType, GrowthStage>> = {
  sown: 'seed',
  planted: 'established',
  germinated: 'seedling',
  transplanted: 'transplanted',
  'first-flower': 'flowering',
  'fruit-set': 'fruiting',
  'first-harvest': 'harvesting',
  harvest: 'harvesting',
  finished: 'finished',
  removed: 'removed',
  failed: 'failed',
};

export class GardenStore {
  private listeners = new Set<() => void>();
  state: StoreState = {
    status: 'loading',
    data: emptyGardenData(),
    problems: [],
    weather: { snapshot: null, loading: false },
    now: new Date(),
  };

  constructor(private repo: GardenRepository, private weatherService: WeatherService, private clock: () => Date = () => new Date()) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private setData(fn: (d: GardenData) => GardenData) {
    this.set({ data: fn(this.state.data) });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init() {
    try {
      const { data, problems } = await this.repo.load();
      const cached = await this.weatherService.cached();
      this.set({ status: 'ready', data, problems, weather: { snapshot: cached, loading: false }, now: this.clock() });
      void this.refreshWeather();
    } catch (e) {
      this.set({ status: 'error', loadError: e instanceof Error ? e.message : String(e) });
    }
  }

  tick() {
    this.set({ now: this.clock() });
  }

  today(): ISODate {
    return todayInTimeZone(this.state.data.profile?.location.timezone ?? 'Australia/Sydney', this.state.now);
  }

  nowIso() {
    return this.clock().toISOString();
  }

  async refreshWeather(force = false) {
    const p = this.state.data.profile;
    const s = this.state.data.settings;
    const lat = p?.location.approxLatitude;
    const lon = p?.location.approxLongitude;
    if (!p || !s.weatherEnabled || lat === undefined || lon === undefined) return;
    this.set({ weather: { ...this.state.weather, loading: true } });
    const r = await this.weatherService.get(lat, lon, p.location.timezone, { force });
    this.set({ weather: { snapshot: r.snapshot, loading: false, error: r.error }, now: this.clock() });
  }

  // -------------------------------------------------------------------------
  // Generic persistence helpers
  // -------------------------------------------------------------------------

  private async putRecord<K extends CollectionName>(c: K, rec: GardenData[K][number]) {
    const saved = await this.repo.put(c, rec as never);
    this.setData((d) => {
      const list = d[c] as { id?: string; taskId?: string }[];
      const key = (x: { id?: string; taskId?: string }) => x.id ?? x.taskId;
      const k = key(saved as never);
      const exists = list.some((x) => key(x) === k);
      const next = exists ? list.map((x) => (key(x) === k ? saved : x)) : [saved, ...list];
      return { ...d, [c]: next };
    });
    return saved;
  }

  private async removeRecord(c: CollectionName, id: string) {
    await this.repo.remove(c, id);
    this.setData((d) => ({ ...d, [c]: (d[c] as { id?: string; taskId?: string }[]).filter((x) => (x.id ?? x.taskId) !== id) }));
  }

  // -------------------------------------------------------------------------
  // Profile & settings
  // -------------------------------------------------------------------------

  async saveProfile(p: Omit<GardenProfile, 'createdAt' | 'updatedAt' | 'id'> & Partial<Pick<GardenProfile, 'createdAt'>>) {
    const now = this.nowIso();
    const prev = this.state.data.profile;
    const locationChanged =
      !prev || prev.location.approxLatitude !== p.location.approxLatitude || prev.location.approxLongitude !== p.location.approxLongitude;
    const profile: GardenProfile = { ...p, id: 'profile', createdAt: prev?.createdAt ?? p.createdAt ?? now, updatedAt: now };
    await this.repo.saveProfile(profile);
    this.setData((d) => ({ ...d, profile }));
    if (locationChanged) void this.refreshWeather(true);
  }

  async saveSettings(patch: Partial<AppSettings>) {
    const settings = { ...this.state.data.settings, ...patch, id: 'settings' as const };
    await this.repo.saveSettings(settings);
    this.setData((d) => ({ ...d, settings }));
  }

  // -------------------------------------------------------------------------
  // Areas
  // -------------------------------------------------------------------------

  async saveArea(a: Omit<GardenArea, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const now = this.nowIso();
    const existing = a.id ? this.state.data.areas.find((x) => x.id === a.id) : undefined;
    const area: GardenArea = { ...a, id: a.id ?? newId('area'), createdAt: existing?.createdAt ?? now, updatedAt: now };
    return this.putRecord('areas', area);
  }

  async deleteArea(id: string) {
    // Plantings keep their history; they just lose the area link.
    for (const p of this.state.data.plantings.filter((x) => x.areaId === id)) {
      const { areaId: _gone, ...rest } = p;
      await this.putRecord('plantings', { ...rest, updatedAt: this.nowIso() });
    }
    await this.removeRecord('areas', id);
  }

  // -------------------------------------------------------------------------
  // Plantings, events, journal
  // -------------------------------------------------------------------------

  async savePlanting(p: Omit<Planting, 'id' | 'createdAt' | 'updatedAt' | 'events'> & { id?: string; events?: PlantingEvent[] }) {
    const now = this.nowIso();
    const existing = p.id ? this.state.data.plantings.find((x) => x.id === p.id) : undefined;
    const events = p.events ?? existing?.events ?? [];
    const initial: PlantingEvent[] =
      !existing && p.stage !== 'planned'
        ? [{ id: newId('ev'), type: p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray' ? 'sown' : 'planted', date: p.plantedDate }]
        : [];
    const planting: Planting = {
      ...p,
      id: p.id ?? newId('pl'),
      events: [...events, ...initial],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.putRecord('plantings', planting);
  }

  async deletePlanting(id: string) {
    await this.removeRecord('plantings', id);
    for (const j of this.state.data.journal.filter((x) => x.plantingId === id)) await this.removeRecord('journal', j.id);
  }

  /** Record a real observation; this replaces estimates in the timeline. */
  async addEvent(plantingId: string, type: PlantingEventType, date: ISODate, note?: string) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p) return;
    const ev: PlantingEvent = { id: newId('ev'), type, date, note: note || undefined };
    const stage = EVENT_STAGE[type];
    const terminal = type === 'finished' || type === 'removed' || type === 'failed';
    await this.putRecord('plantings', {
      ...p,
      events: [...p.events, ev],
      stage: stage ?? p.stage,
      stageIsManual: terminal ? true : p.stageIsManual,
      updatedAt: this.nowIso(),
    });
  }

  /** A planned planting (e.g. a Three Sisters step) has actually been sown/planted. */
  async markStarted(plantingId: string, date: ISODate) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p || p.stage !== 'planned') return;
    const seed = p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray';
    await this.putRecord('plantings', {
      ...p,
      plantedDate: date,
      dateAccuracy: 'exact',
      stage: seed ? 'seed' : 'established',
      stageIsManual: false,
      events: [...p.events, { id: newId('ev'), type: seed ? 'sown' : 'planted', date }],
      updatedAt: this.nowIso(),
    });
  }

  async removeEvent(plantingId: string, eventId: string) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p) return;
    await this.putRecord('plantings', { ...p, events: p.events.filter((e) => e.id !== eventId), updatedAt: this.nowIso() });
  }

  async setStage(plantingId: string, stage: GrowthStage | 'auto') {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p) return;
    await this.putRecord('plantings', {
      ...p,
      stage: stage === 'auto' ? (p.stage === 'planned' ? 'seed' : p.stage) : stage,
      stageIsManual: stage !== 'auto',
      updatedAt: this.nowIso(),
    });
  }

  async addJournal(text: string, date: ISODate, links: { plantingId?: string; areaId?: string } = {}) {
    const entry: JournalEntry = { id: newId('jn'), date, text: text.trim(), ...links, createdAt: this.nowIso() };
    return this.putRecord('journal', entry);
  }

  async deleteJournal(id: string) {
    await this.removeRecord('journal', id);
  }

  // -------------------------------------------------------------------------
  // Wish list
  // -------------------------------------------------------------------------

  isWished(plantId: string) {
    return this.state.data.wishlist.some((w) => w.plantId === plantId);
  }

  async toggleWish(plantId: string, note?: string) {
    const existing = this.state.data.wishlist.find((w) => w.plantId === plantId);
    if (existing) await this.removeRecord('wishlist', existing.id);
    else await this.putRecord('wishlist', { id: newId('wish'), plantId, note, addedAt: this.nowIso() });
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  async respondToTask(taskId: string, status: TaskResponseStatus, until?: ISODate) {
    await this.putRecord('taskResponses', { taskId, status, until, at: this.nowIso() });
  }

  async undoTaskResponse(taskId: string) {
    await this.removeRecord('taskResponses', taskId);
  }

  // -------------------------------------------------------------------------
  // Succession
  // -------------------------------------------------------------------------

  private recalcCtx(plantId: string) {
    const plant = getPlant(plantId)!;
    return { zone: effectiveZone(this.state.data.profile?.location), plant, now: this.nowIso() };
  }

  async createSuccessionPlan(plantId: string, areaId: string | undefined, startDate: ISODate, freeAreaM2: number | null) {
    const prof = this.state.data.profile;
    const plant = getPlant(plantId);
    if (!prof || !plant) throw new Error('Set up your Garden Profile first.');
    const proposal = proposeSuccession(plant, {
      zone: effectiveZone(prof.location),
      startDate,
      householdSize: prof.householdSize,
      level: productionLevelFromGoals(prof.goals),
      timeBudget: prof.timeBudget,
      freeAreaM2,
    });
    if (!proposal.suitable) throw new Error(proposal.reason ?? 'This crop is not suited to succession planting.');
    const plan = planFromProposal(proposal, { id: newId('sp'), plantId, areaId, now: this.nowIso() });
    return this.putRecord('successionPlans', plan);
  }

  private findPlan(id: string): SuccessionPlan {
    const plan = this.state.data.successionPlans.find((x) => x.id === id);
    if (!plan) throw new Error('Succession plan not found');
    return plan;
  }

  /** Accept a batch: creates the real planting and re-anchors the plan. */
  async acceptSuccessionBatch(planId: string, index: number, date: ISODate, quantity?: number) {
    const plan = this.findPlan(planId);
    const batch = plan.batches.find((b) => b.index === index);
    const plant = getPlant(plan.plantId);
    if (!batch || !plant) return;
    const method = plant.startMethods.includes('direct-sow') ? 'direct-sow' : plant.startMethods[0];
    const planting = await this.savePlanting({
      plantId: plan.plantId,
      quantity: quantity ?? batch.quantity,
      areaId: plan.areaId,
      startMethod: method,
      plantedDate: date,
      dateAccuracy: 'exact',
      stage: 'seed',
      stageIsManual: false,
      successionPlanId: plan.id,
    });
    await this.putRecord('successionPlans', acceptBatch(plan, index, planting.id, date, this.recalcCtx(plan.plantId)));
  }

  async postponeSuccessionBatch(planId: string, index: number, days: number) {
    const plan = this.findPlan(planId);
    await this.putRecord('successionPlans', postponeBatch(plan, index, days, this.recalcCtx(plan.plantId)));
  }

  async skipSuccessionBatch(planId: string, index: number) {
    const plan = this.findPlan(planId);
    await this.putRecord('successionPlans', skipBatch(plan, index, this.recalcCtx(plan.plantId)));
  }

  async setSuccessionQuantity(planId: string, index: number, qty: number, applyToFuture: boolean) {
    const plan = this.findPlan(planId);
    await this.putRecord('successionPlans', setBatchQuantity(plan, index, qty, applyToFuture, this.nowIso()));
  }

  async stopSuccession(planId: string) {
    await this.putRecord('successionPlans', stopPlan(this.findPlan(planId), this.nowIso()));
  }

  async recalculateSuccession(planId: string) {
    const plan = this.findPlan(planId);
    await this.putRecord('successionPlans', recalculate(plan, this.recalcCtx(plan.plantId)));
  }

  async deleteSuccession(planId: string) {
    await this.removeRecord('successionPlans', planId);
  }

  // -------------------------------------------------------------------------
  // Planting systems
  // -------------------------------------------------------------------------

  /** Start a Three Sisters planting: the corn is sown now; later steps are planned plantings. */
  async startThreeSisters(opts: { startDate: ISODate; areaId?: string; mounds: number; cornAlreadySown: boolean }) {
    const zone = effectiveZone(this.state.data.profile?.location);
    const plan = planSystem(THREE_SISTERS, opts.startDate, zone, getPlant);
    const planId = newId('sys');
    const perMound: Record<string, number> = { support: 6, climber: 4, groundcover: 4 };
    for (const step of plan.steps) {
      const anchor = step.role === 'support';
      const qty = step.role === 'groundcover' ? Math.max(1, Math.ceil(opts.mounds / 7) * perMound.groundcover) : opts.mounds * perMound[step.role];
      await this.savePlanting({
        plantId: step.plant.id,
        quantity: qty,
        areaId: opts.areaId,
        startMethod: 'direct-sow',
        plantedDate: anchor ? opts.startDate : step.suggested,
        dateAccuracy: anchor ? 'exact' : 'approx-week',
        stage: anchor && opts.cornAlreadySown ? 'seed' : 'planned',
        stageIsManual: false,
        notes: step.trigger ? `Three Sisters: sow ${step.trigger}.` : 'Three Sisters: the corn goes in first.',
        system: { planId, systemId: THREE_SISTERS.id, role: step.role },
      });
    }
    return plan;
  }

  // -------------------------------------------------------------------------
  // Whole-garden operations
  // -------------------------------------------------------------------------

  exportData(): GardenData {
    return this.state.data;
  }

  /** Replace everything with validated backup data (atomic in the repository). */
  async restore(data: GardenData) {
    await this.repo.replaceAll(data);
    const { data: loaded, problems } = await this.repo.load();
    this.set({ data: loaded, problems });
    void this.refreshWeather(true);
  }

  async deleteAllData() {
    await this.repo.deleteEverything();
    await this.weatherService.clear().catch(() => undefined);
    this.set({ data: emptyGardenData(), problems: [], weather: { snapshot: null, loading: false } });
  }

  /** Default date for new plantings: today in the garden's timezone. */
  defaultDate(offsetDays = 0) {
    return addDays(this.today(), offsetDays);
  }
}
