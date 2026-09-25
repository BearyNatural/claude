/**
 * Weather alerts while the app is closed (Android). A background task — run by
 * the phone a few times a day when it chooses, and not guaranteed — checks
 * each garden's forecast and notifies about frost, extreme heat or heavy rain
 * today or tomorrow. Off until the gardener turns it on in Reminders.
 * Only rounded coordinates are sent to the weather service, as in the app.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { weatherAlerts } from '../../domain/alerts';
import { todayInTimeZone } from '../../domain/dates';
import { allGardens } from '../../domain/gardens';
import { assessWeather } from '../../domain/weather';
import { coordinatesForPostcode } from '../location/geocode';
import { asyncStorageStore } from '../storage/asyncStorageStore';
import { GardenRepository } from '../storage/gardenRepository';
import { fetchForecast } from '../weather/openMeteo';

export const WEATHER_ALERTS_TASK = 'sow-by-season-weather-alerts';
const CHANNEL = 'weather-alerts';
const SENT_KEY = 'sbs:alerts:sent';
/** Minutes between runs requested from Android (it may run less often). */
const INTERVAL_MIN = 180;

async function sentKeys(): Promise<string[]> {
  try {
    const raw = await asyncStorageStore.getItem(SENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Check every garden once and send any new alerts. Returns how many were sent. */
export async function runWeatherAlertCheck(now = new Date()): Promise<number> {
  const { data } = await new GardenRepository(asyncStorageStore).load();
  if (!data.profile || !data.settings.weatherEnabled || !data.settings.backgroundAlerts) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Weather alerts', importance: Notifications.AndroidImportance.HIGH });
  const sent = await sentKeys();
  let count = 0;
  for (const g of allGardens(data)) {
    const pc = g.location.approxLatitude === undefined ? coordinatesForPostcode(g.location.postcode) : null;
    const lat = g.location.approxLatitude ?? pc?.lat;
    const lon = g.location.approxLongitude ?? pc?.lon;
    if (lat === undefined || lon === undefined) continue;
    try {
      const snap = await fetchForecast(lat, lon, g.location.timezone, { fetch: (u, i) => fetch(u, i), now: () => now });
      const today = todayInTimeZone(g.location.timezone, now);
      for (const a of weatherAlerts(assessWeather(snap, today, now), today, g)) {
        if (sent.includes(a.key)) continue;
        await Notifications.scheduleNotificationAsync({ content: { title: a.title, body: a.body }, trigger: { channelId: CHANNEL } as Notifications.NotificationTriggerInput });
        sent.push(a.key);
        count++;
      }
    } catch {
      // Offline or the weather service is unavailable — try again next run.
    }
  }
  await asyncStorageStore.setItem(SENT_KEY, JSON.stringify(sent.slice(-100))).catch(() => undefined);
  return count;
}

// Must be defined when the JavaScript bundle loads, so Android can run it without the app open.
TaskManager.defineTask(WEATHER_ALERTS_TASK, async () => {
  try {
    await runWeatherAlertCheck();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Turn the background check on or off to match the setting. */
export async function syncWeatherAlerts(enabled: boolean): Promise<'on' | 'off' | 'unavailable'> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return 'unavailable';
    const registered = await TaskManager.isTaskRegisteredAsync(WEATHER_ALERTS_TASK);
    if (enabled && !registered) await BackgroundTask.registerTaskAsync(WEATHER_ALERTS_TASK, { minimumInterval: INTERVAL_MIN });
    if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(WEATHER_ALERTS_TASK);
    return enabled ? 'on' : 'off';
  } catch {
    return 'unavailable';
  }
}
