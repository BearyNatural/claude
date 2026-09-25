/**
 * React bindings for the GardenStore, plus a single "derived view" hook that
 * runs the domain engine over current state. Screens use these instead of
 * re-implementing rules.
 */
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { effectiveFrostRisk, effectiveZone } from '../domain/climate';
import { hourInTimeZone } from '../domain/dates';
import { activeGarden, allGardens, scopeToGarden } from '../domain/gardens';
import { buildPlantNow, type RecommendContext } from '../domain/recommend';
import { planReminders } from '../domain/reminders';
import { generateTasks } from '../domain/tasks';
import { assessWeather } from '../domain/weather';
import { planWeek } from '../domain/workload';
import { scheduleReminders } from '../services/notifications/notificationService';
import { catalogue, getPlant, type GardenStore, type StoreState } from './gardenStore';

const StoreContext = createContext<GardenStore | null>(null);

export function StoreProvider({ store, children }: { store: GardenStore; children: ReactNode }) {
  useEffect(() => {
    void store.init();
    const tick = setInterval(() => store.tick(), 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        store.tick();
        void store.refreshWeather();
      }
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): GardenStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function useGardenState(): StoreState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Everything the main screens need, computed by the domain engine. */
export function useGardenView() {
  const store = useStore();
  const state = useGardenState();
  const { weather, now, catalogueRev } = state;
  const allData = state.data;
  // Everything below sees the garden currently shown: its own areas, plantings,
  // notes and plans, and its location (zone, weather, timezone).
  const garden = useMemo(() => activeGarden(allData), [allData]);
  const gardens = useMemo(() => allGardens(allData), [allData]);
  const data = useMemo(() => (garden ? scopeToGarden(allData, garden.id) : allData), [allData, garden]);
  const profile = useMemo(
    () => (allData.profile && garden ? { ...allData.profile, location: garden.location, property: garden.property, gardenName: garden.name } : allData.profile),
    [allData.profile, garden],
  );
  const today = store.today();
  const zone = effectiveZone(profile?.location);
  const frostRisk = effectiveFrostRisk(profile?.location);
  const assessment = useMemo(
    () => assessWeather(data.settings.weatherEnabled ? weather.snapshot : null, today, now),
    [weather.snapshot, today, now, data.settings.weatherEnabled],
  );
  const hidden = useMemo(() => new Set(data.settings.hiddenPlantIds), [data.settings.hiddenPlantIds]);
  const recCtx: RecommendContext = useMemo(
    () => ({
      today,
      zone,
      frostRisk,
      weather: assessment,
      goals: profile?.goals ?? [],
      timeBudget: profile?.timeBudget ?? '1to2',
      householdSize: profile?.householdSize ?? 1,
      plantings: data.plantings,
      areas: data.areas,
      wishlistPlantIds: new Set(data.wishlist.map((w) => w.plantId)),
      getPlant,
    }),
    // catalogueRev: getPlant's answers change when the plant list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, zone, frostRisk, assessment, profile, data.plantings, data.areas, data.wishlist, catalogueRev],
  );
  const plantNow = useMemo(() => buildPlantNow(catalogue.all, recCtx, hidden), [recCtx, hidden]);
  const tasks = useMemo(
    () =>
      generateTasks({
        today,
        zone,
        weather: assessment,
        areas: data.areas,
        plantings: data.plantings,
        journal: data.journal,
        successionPlans: data.successionPlans,
        wishlist: data.wishlist,
        responses: data.taskResponses,
        getPlant,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, zone, assessment, data, catalogueRev],
  );
  const week = useMemo(
    () => planWeek(tasks, { timeBudget: profile?.timeBudget ?? '1to2', gardeningDays: profile?.reminders.gardeningDays ?? [], today }),
    [tasks, profile, today],
  );
  return { store, state, data, allData, profile, garden, gardens, today, zone, frostRisk, weather: assessment, weatherState: weather, recCtx, plantNow, tasks, week };
}

/**
 * Keeps OS-scheduled reminders in step with the garden. Runs whenever tasks
 * or reminder preferences change (i.e. while the app is open) — see
 * docs/ARCHITECTURE.md for background-execution limits.
 */
export function useReminderSync() {
  const { profile, tasks, today, state } = useGardenView();
  useEffect(() => {
    if (!profile || state.status !== 'ready') return;
    const hour = hourInTimeZone(profile.location.timezone, state.now);
    const plan = planReminders({
      tasks,
      prefs: profile.reminders,
      timeBudget: profile.timeBudget,
      today,
      nowTime: `${String(hour).padStart(2, '0')}:${String(state.now.getMinutes()).padStart(2, '0')}`,
      horizonDays: 7,
    });
    const t = setTimeout(() => void scheduleReminders(plan).catch(() => undefined), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.reminders, profile?.timeBudget, tasks.map((t) => t.id).join('|'), today, state.status]);
}
