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
import { CATALOGUE_VERSION, PLANTS } from '../data/plants';
import { SOURCES } from '../data/sources';
import { THREE_SISTERS } from '../data/systems';
import { createCatalogue, rebuildCatalogue } from '../domain/catalogue';
import type { ParsedFeed } from '../domain/catalogueUpdate';
import { CUSTOM_PREFIX, customToPlantRecord } from '../domain/customPlants';
import { effectiveZone } from '../domain/climate';
import { addDays, todayInTimeZone } from '../domain/dates';
import { activeGarden, gardenContents, HOME_GARDEN, type ActiveGarden, type GardenSite } from '../domain/gardens';
import { outlineDimensionsM, polygonAreaM2, roundTenth, type LatLon } from '../domain/geometry';
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
  type CustomPlant,
  type GardenArea,
  type GardenData,
  type GardenProfile,
  type GrowthStage,
  type ISODate,
  type JournalEntry,
  type Planting,
  type PlantingEvent,
  type PlantingEventType,
  type PlantingPhoto,
  type PropertyLocation,
  type SuccessionPlan,
  type TaskResponseStatus,
} from '../domain/types';
import type { WeatherSnapshot } from '../domain/weather';
import { areaIdsOf, isInArea, toAreaIds } from '../domain/plantingAreas';
import { coordinatesForPostcode } from '../services/location/geocode';
import { memoryPhotoFiles, type PhotoFiles } from '../services/photos/photoFiles';
import type { CatalogueUpdates } from '../services/catalogue/catalogueUpdates';
import type { SuggestionSender } from '../services/plants/plantSuggestions';
import type { AppRelease, AppUpdates } from '../services/updates/appUpdates';
import type { CollectionName, GardenRepository, LoadProblem } from '../services/storage/gardenRepository';
import type { WeatherService } from '../services/weather/weatherService';

/** The live catalogue: bundled plants + downloaded updates + the gardener's own plants. */
export const catalogue = createCatalogue(PLANTS);
export const getPlant = (id: string) => catalogue.byId.get(id);

export interface CatalogueInfo {
  /** Version of the plant list in use (bundled, or a newer downloaded one). */
  version: string;
  fromUpdate: boolean;
  /** Plants the downloaded list adds beyond those built into the app. */
  added: number;
  updatedAt?: string;
  checking?: boolean;
  error?: string;
}

export interface WeatherState {
  snapshot: WeatherSnapshot | null;
  loading: boolean;
  error?: string;
  /** True when the saved location has no suburb or postcode to get a forecast for. */
  needsLocation?: boolean;
}

export interface StoreState {
  status: 'loading' | 'ready' | 'error';
  loadError?: string;
  data: GardenData;
  problems: LoadProblem[];
  weather: WeatherState;
  /** Bumped every minute-ish so "today" stays current while the app is open. */
  now: Date;
  /** Bumped whenever the catalogue changes (own plants added, plant list updated). */
  catalogueRev: number;
  catalogueInfo: CatalogueInfo;
  /** A newer version of the phone app, when one has been released. */
  appUpdate: AppRelease | null;
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
    catalogueRev: 0,
    catalogueInfo: { version: CATALOGUE_VERSION, fromUpdate: false, added: 0 },
    appUpdate: null,
  };
  private feed: ParsedFeed | null = null;

  constructor(
    private repo: GardenRepository,
    private weatherService: WeatherService,
    private clock: () => Date = () => new Date(),
    private photos: PhotoFiles = memoryPhotoFiles(),
    private plantList: CatalogueUpdates | null = null,
    private appUpdates: AppUpdates | null = null,
    /** Sends an opted-in plant to the plant list suggestions inbox (absent where sharing isn't available). */
    private shareSuggestion: SuggestionSender | null = null,
  ) {}

  /** Whether plants can be shared from this copy of the app. */
  get canSharePlants(): boolean {
    return !!this.shareSuggestion;
  }

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

  /** The garden currently shown (home unless the gardener switched). */
  get garden(): ActiveGarden | null {
    return activeGarden(this.state.data);
  }

  /** New records belong to the garden currently shown; existing ones keep theirs. */
  private stamp<T extends { gardenId?: string }>(rec: T, existing?: { gardenId?: string }): T {
    const g = this.garden;
    const gid = existing ? existing.gardenId : g && !g.isHome ? g.id : undefined;
    const { gardenId: _drop, ...rest } = rec;
    return (gid ? { ...rest, gardenId: gid } : rest) as T;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init() {
    try {
      const { data, problems } = await this.repo.load();
      await this.photos.ready?.();
      const cached = await this.weatherService.cached();
      this.feed = (await this.plantList?.cached()) ?? null;
      this.set({ status: 'ready', data, problems, weather: { snapshot: cached, loading: false }, now: this.clock() });
      this.applyCatalogue();
      void this.refreshWeather();
      if (data.settings.plantListUpdates !== false) void this.checkPlantList();
      void this.checkAppUpdate();
      void this.sendPendingShares();
    } catch (e) {
      this.set({ status: 'error', loadError: e instanceof Error ? e.message : String(e) });
    }
  }

  tick() {
    this.set({ now: this.clock() });
  }

  today(): ISODate {
    return todayInTimeZone(this.garden?.location.timezone ?? 'Australia/Sydney', this.state.now);
  }

  nowIso() {
    return this.clock().toISOString();
  }

  async refreshWeather(force = false) {
    const loc = this.garden?.location;
    const s = this.state.data.settings;
    if (!loc || !s.weatherEnabled) return;
    // Locations set manually may only have a postcode: use its approximate centre.
    const fromPc = loc.approxLatitude === undefined ? coordinatesForPostcode(loc.postcode) : null;
    const lat = loc.approxLatitude ?? fromPc?.lat;
    const lon = loc.approxLongitude ?? fromPc?.lon;
    if (lat === undefined || lon === undefined) {
      this.set({ weather: { snapshot: null, loading: false, needsLocation: true } });
      return;
    }
    this.set({ weather: { ...this.state.weather, loading: true, needsLocation: false } });
    const r = await this.weatherService.get(lat, lon, loc.timezone, { force });
    this.set({ weather: { snapshot: r.snapshot, loading: false, error: r.error }, now: this.clock() });
  }

  // -------------------------------------------------------------------------
  // Catalogue: plant list updates and the gardener's own plants
  // -------------------------------------------------------------------------

  private applyCatalogue(patch: Partial<CatalogueInfo> = {}) {
    rebuildCatalogue(catalogue, PLANTS, this.feed?.plants ?? [], this.state.data.customPlants.map(customToPlantRecord));
    if (this.feed) Object.assign(SOURCES, this.feed.sources);
    const bundled = new Set(PLANTS.map((p) => p.id));
    this.set({
      catalogueRev: this.state.catalogueRev + 1,
      catalogueInfo: {
        ...this.state.catalogueInfo,
        version: this.feed?.catalogueVersion ?? CATALOGUE_VERSION,
        fromUpdate: !!this.feed,
        added: this.feed ? this.feed.plants.filter((p) => !bundled.has(p.id)).length : 0,
        updatedAt: this.feed?.generatedAt,
        ...patch,
      },
    });
  }

  /** Look for a newer version of the phone app (daily at most, unless forced). */
  async checkAppUpdate(force = false) {
    if (!this.appUpdates) return;
    const appUpdate = await this.appUpdates.check(force);
    this.set({ appUpdate });
  }

  /** Download a newer plant list if there is one (daily at most, unless forced). */
  async checkPlantList(force = false) {
    if (!this.plantList) return;
    this.set({ catalogueInfo: { ...this.state.catalogueInfo, checking: true, error: undefined } });
    const r = await this.plantList.check(force);
    if (r.feed) this.feed = r.feed;
    this.applyCatalogue({ checking: false, error: r.error });
  }

  async saveCustomPlant(input: Omit<CustomPlant, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CustomPlant> {
    const now = this.nowIso();
    const existing = input.id ? this.state.data.customPlants.find((c) => c.id === input.id) : undefined;
    const rec: CustomPlant = { ...input, id: existing?.id ?? newId(CUSTOM_PREFIX.slice(0, -1)), createdAt: existing?.createdAt ?? now, updatedAt: now };
    const saved = await this.putRecord('customPlants', rec);
    this.applyCatalogue();
    if (saved.share?.status === 'pending') void this.sendPendingShares();
    return saved;
  }

  /** Send any plants the gardener chose to share that haven't gone yet (e.g. added while offline). */
  async sendPendingShares() {
    if (!this.shareSuggestion) return;
    const zone = effectiveZone(this.garden?.location);
    for (const c of this.state.data.customPlants.filter((x) => x.share?.status === 'pending')) {
      try {
        const ref = await this.shareSuggestion(c, zone);
        const latest = this.state.data.customPlants.find((x) => x.id === c.id);
        if (latest?.share?.status === 'pending') await this.putRecord('customPlants', { ...latest, share: { status: 'shared', sharedAt: this.nowIso(), ...(ref ? { ref } : {}) } });
      } catch {
        // Stays pending; tried again next time the app opens.
      }
    }
  }

  /** Remove one of the gardener's own plants — refused while plantings or the wish list still use it. */
  async deleteCustomPlant(id: string): Promise<{ ok: true } | { ok: false; inUse: number }> {
    const inUse = this.state.data.plantings.filter((p) => p.plantId === id).length + this.state.data.wishlist.filter((w) => w.plantId === id).length;
    if (inUse) return { ok: false, inUse };
    await this.removeRecord('customPlants', id);
    this.applyCatalogue();
    return { ok: true };
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
      !prev ||
      prev.location.approxLatitude !== p.location.approxLatitude ||
      prev.location.approxLongitude !== p.location.approxLongitude ||
      prev.location.postcode !== p.location.postcode;
    const profile: GardenProfile = { ...p, id: 'profile', createdAt: prev?.createdAt ?? p.createdAt ?? now, updatedAt: now };
    await this.repo.saveProfile(profile);
    this.setData((d) => ({ ...d, profile }));
    if (locationChanged) void this.refreshWeather(true);
  }

  /**
   * Change some profile fields (reminders, household…) on the stored profile.
   * Use this rather than saving a profile from a screen's view, which shows the
   * garden currently selected and so may carry another garden's location.
   */
  async updateProfile(patch: Partial<Omit<GardenProfile, 'id' | 'createdAt' | 'updatedAt' | 'location'>>) {
    const prev = this.state.data.profile;
    if (!prev) return;
    await this.saveProfile({ ...prev, ...patch });
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
    const area: GardenArea = this.stamp({ ...a, id: a.id ?? newId('area'), createdAt: existing?.createdAt ?? now, updatedAt: now }, existing);
    return this.putRecord('areas', area);
  }

  async deleteArea(id: string) {
    // Plantings keep their history; they just lose the area link.
    for (const p of this.state.data.plantings.filter((x) => isInArea(x, id))) {
      const { areaIds: _gone, ...rest } = p;
      const left = toAreaIds(areaIdsOf(p).filter((a) => a !== id));
      await this.putRecord('plantings', { ...rest, ...(left ? { areaIds: left } : {}), updatedAt: this.nowIso() });
    }
    await this.removeRecord('areas', id);
  }

  // -------------------------------------------------------------------------
  // Plantings, events, journal
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Photos (files kept in app storage on this device)
  // -------------------------------------------------------------------------

  photoUri(file: string): string {
    return this.photos.uri(file);
  }

  photoExists(file: string): boolean {
    return this.photos.exists(file);
  }

  /** Add picked or captured images to a planting (each is shrunk and copied into app storage). */
  async addPhotos(plantingId: string, images: { uri: string; width?: number; height?: number }[]) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p || !images.length) return;
    const added: PlantingPhoto[] = [];
    for (const img of images) {
      const file = await this.photos.importImage(img.uri, img.width && img.height ? { width: img.width, height: img.height } : undefined);
      added.push({ id: newId('pho'), file, takenAt: this.nowIso() });
    }
    const latest = this.state.data.plantings.find((x) => x.id === plantingId) ?? p;
    await this.putRecord('plantings', { ...latest, photos: [...(latest.photos ?? []), ...added], updatedAt: this.nowIso() });
  }

  async removePhoto(plantingId: string, photoId: string) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    const ph = p?.photos?.find((x) => x.id === photoId);
    if (!p || !ph) return;
    this.photos.remove(ph.file);
    const rest = p.photos!.filter((x) => x.id !== photoId);
    const { photos: _old, ...base } = p;
    await this.putRecord('plantings', { ...base, ...(rest.length ? { photos: rest } : {}), updatedAt: this.nowIso() });
  }

  async setPhotoCaption(plantingId: string, photoId: string, caption: string) {
    const p = this.state.data.plantings.find((x) => x.id === plantingId);
    if (!p?.photos?.some((x) => x.id === photoId)) return;
    const photos = p.photos.map((x) => (x.id === photoId ? { ...x, caption: caption.trim() || undefined } : x));
    await this.putRecord('plantings', { ...p, photos, updatedAt: this.nowIso() });
  }

  /** Every photo file the garden uses and that is on this phone, as base64 — for backups. */
  async photoFilesForBackup(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const p of this.state.data.plantings) {
      for (const ph of p.photos ?? []) {
        if (!out[ph.file] && this.photos.exists(ph.file)) out[ph.file] = await this.photos.readBase64(ph.file);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Several gardens
  // -------------------------------------------------------------------------

  /** Add or update an extra garden (the home garden lives in the profile). */
  async saveGarden(input: Omit<GardenSite, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<GardenSite> {
    const now = this.nowIso();
    const existing = input.id ? this.state.data.gardens.find((g) => g.id === input.id) : undefined;
    const site: GardenSite = { ...input, name: input.name.trim() || 'Garden', id: existing?.id ?? newId('gdn'), createdAt: existing?.createdAt ?? now, updatedAt: now };
    const saved = await this.putRecord('gardens', site);
    if (this.garden?.id === saved.id && existing && JSON.stringify(existing.location) !== JSON.stringify(saved.location)) void this.refreshWeather(true);
    return saved;
  }

  /** Rename any garden, including home (whose name is the profile's garden name). */
  async renameGarden(id: string, name: string) {
    if (id === HOME_GARDEN) {
      const prev = this.state.data.profile;
      if (prev) await this.saveProfile({ ...prev, gardenName: name.trim() || undefined });
      return;
    }
    const site = this.state.data.gardens.find((g) => g.id === id);
    if (site) await this.saveGarden({ ...site, name });
  }

  /** Remove an extra garden — only once it's empty (move or remove its areas and plantings first). */
  async deleteGarden(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (id === HOME_GARDEN) return { ok: false, reason: 'The home garden can\'t be removed.' };
    const c = gardenContents(this.state.data, id);
    const total = c.areas + c.plantings + c.notes + c.plans;
    if (total) return { ok: false, reason: `It still has ${c.areas} area(s), ${c.plantings} planting(s), ${c.notes} note(s) and ${c.plans} plan(s). Remove those first.` };
    if (this.state.data.settings.activeGardenId === id) await this.setActiveGarden(HOME_GARDEN);
    await this.removeRecord('gardens', id);
    return { ok: true };
  }

  /** Switch the garden shown everywhere (tasks, weather, map, plantings). */
  async setActiveGarden(id: string) {
    if (id !== HOME_GARDEN && !this.state.data.gardens.some((g) => g.id === id)) return;
    await this.saveSettings({ activeGardenId: id === HOME_GARDEN ? undefined : id });
    void this.refreshWeather(true);
  }

  // -------------------------------------------------------------------------
  // Garden map (optional; precise locations stay on this device)
  // -------------------------------------------------------------------------

  /** Save the map location of the garden currently shown. */
  async setProperty(property: PropertyLocation) {
    const g = this.garden;
    const prev = this.state.data.profile;
    if (!g || !prev) return;
    if (g.isHome) await this.saveProfile({ ...prev, property });
    else {
      const site = this.state.data.gardens.find((x) => x.id === g.id);
      if (site) await this.saveGarden({ ...site, property });
    }
  }

  /** Save an outline traced on the map, and the size measured from it. */
  async saveAreaOutline(areaId: string, outline: LatLon[]) {
    const area = this.state.data.areas.find((a) => a.id === areaId);
    if (!area) return;
    const dims = outlineDimensionsM(outline);
    await this.saveArea({
      ...area,
      outline,
      usableAreaM2: roundTenth(polygonAreaM2(outline)),
      ...(dims ? { lengthM: roundTenth(dims.lengthM), widthM: roundTenth(dims.widthM) } : {}),
    });
  }

  /**
   * Fold a duplicate area into another: its plantings, journal notes, plans and
   * readings move across, the kept area gains its map outline and any details it
   * lacks, and the duplicate is removed.
   */
  async mergeAreas(duplicateId: string, keepId: string) {
    const d = this.state.data;
    const dup = d.areas.find((a) => a.id === duplicateId);
    const keep = d.areas.find((a) => a.id === keepId);
    if (!dup || !keep || dup.id === keep.id) return;
    const now = this.nowIso();
    const fromMap = !keep.outline && dup.outline
      ? { outline: dup.outline, usableAreaM2: dup.usableAreaM2, lengthM: dup.lengthM, widthM: dup.widthM }
      : {};
    await this.saveArea({
      ...keep,
      ...fromMap,
      lengthM: fromMap.lengthM ?? keep.lengthM ?? dup.lengthM,
      widthM: fromMap.widthM ?? keep.widthM ?? dup.widthM,
      usableAreaM2: fromMap.usableAreaM2 ?? keep.usableAreaM2 ?? dup.usableAreaM2,
      sunHours: keep.sunHours ?? dup.sunHours,
      soilType: keep.soilType && keep.soilType !== 'unknown' ? keep.soilType : dup.soilType ?? keep.soilType,
      drainage: keep.drainage && keep.drainage !== 'unknown' ? keep.drainage : dup.drainage ?? keep.drainage,
      irrigation: keep.irrigation && keep.irrigation !== 'unknown' ? keep.irrigation : dup.irrigation ?? keep.irrigation,
      container: keep.container ?? dup.container,
      notes: [keep.notes, dup.notes].filter(Boolean).join('\n\n') || undefined,
    });
    for (const p of d.plantings.filter((x) => isInArea(x, dup.id))) {
      await this.putRecord('plantings', { ...p, areaIds: toAreaIds(areaIdsOf(p).map((a) => (a === dup.id ? keep.id : a))), updatedAt: now });
    }
    for (const j of d.journal.filter((x) => x.areaId === dup.id)) await this.putRecord('journal', { ...j, areaId: keep.id });
    for (const s of d.successionPlans.filter((x) => x.areaId === dup.id)) await this.putRecord('successionPlans', { ...s, areaId: keep.id, updatedAt: now });
    for (const o of d.observations.filter((x) => x.areaId === dup.id)) await this.putRecord('observations', { ...o, areaId: keep.id });
    await this.removeRecord('areas', dup.id);
  }

  /** Forget the saved address and every traced outline. Measured sizes are kept. */
  async clearMapData() {
    const prev = this.state.data.profile;
    if (prev?.property) {
      const { property: _gone, ...rest } = prev;
      await this.saveProfile(rest);
    }
    for (const site of this.state.data.gardens.filter((x) => x.property)) {
      const { property: _p, ...rest } = site;
      await this.saveGarden(rest);
    }
    for (const a of this.state.data.areas.filter((x) => x.outline)) {
      const { outline: _o, ...rest } = a;
      await this.saveArea(rest);
    }
  }

  async savePlanting(p: Omit<Planting, 'id' | 'createdAt' | 'updatedAt' | 'events'> & { id?: string; events?: PlantingEvent[] }) {
    const now = this.nowIso();
    const existing = p.id ? this.state.data.plantings.find((x) => x.id === p.id) : undefined;
    const events = p.events ?? existing?.events ?? [];
    const initial: PlantingEvent[] =
      !existing && p.stage !== 'planned'
        ? [{ id: newId('ev'), type: p.startMethod === 'direct-sow' || p.startMethod === 'seed-tray' ? 'sown' : 'planted', date: p.plantedDate }]
        : [];
    const planting: Planting = this.stamp(
      {
        ...p,
        id: p.id ?? newId('pl'),
        events: [...events, ...initial],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      existing,
    );
    return this.putRecord('plantings', planting);
  }

  async deletePlanting(id: string) {
    const gone = this.state.data.plantings.find((x) => x.id === id);
    for (const ph of gone?.photos ?? []) this.photos.remove(ph.file);
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
    const entry = this.stamp<JournalEntry>({ id: newId('jn'), date, text: text.trim(), ...links, createdAt: this.nowIso() });
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
    return { zone: effectiveZone(this.garden?.location), plant, now: this.nowIso() };
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
    const plan = this.stamp(planFromProposal(proposal, { id: newId('sp'), plantId, areaId, now: this.nowIso() }));
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
      areaIds: toAreaIds(plan.areaId ? [plan.areaId] : []),
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
    const zone = effectiveZone(this.garden?.location);
    const plan = planSystem(THREE_SISTERS, opts.startDate, zone, getPlant);
    const planId = newId('sys');
    const perMound: Record<string, number> = { support: 6, climber: 4, groundcover: 4 };
    for (const step of plan.steps) {
      const anchor = step.role === 'support';
      const qty = step.role === 'groundcover' ? Math.max(1, Math.ceil(opts.mounds / 7) * perMound.groundcover) : opts.mounds * perMound[step.role];
      await this.savePlanting({
        plantId: step.plant.id,
        quantity: qty,
        areaIds: toAreaIds(opts.areaId ? [opts.areaId] : []),
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

  /**
   * Replace everything with validated backup data (atomic in the repository).
   * Photo files from the backup are written first; photos on this phone that
   * no restored planting uses are then removed.
   */
  async restore(data: GardenData, photoFiles: Record<string, string> = {}) {
    for (const [file, b64] of Object.entries(photoFiles)) this.photos.writeBase64(file, b64);
    await this.repo.replaceAll(data);
    const keep = new Set(data.plantings.flatMap((p) => (p.photos ?? []).map((ph) => ph.file)));
    for (const f of this.photos.list()) if (!keep.has(f)) this.photos.remove(f);
    const { data: loaded, problems } = await this.repo.load();
    this.set({ data: loaded, problems });
    this.applyCatalogue();
    void this.refreshWeather(true);
  }

  async deleteAllData() {
    await this.repo.deleteEverything();
    this.photos.removeAll();
    await this.weatherService.clear().catch(() => undefined);
    this.set({ data: emptyGardenData(), problems: [], weather: { snapshot: null, loading: false } });
    this.applyCatalogue();
  }

  /** Default date for new plantings: today in the garden's timezone. */
  defaultDate(offsetDays = 0) {
    return addDays(this.today(), offsetDays);
  }
}
