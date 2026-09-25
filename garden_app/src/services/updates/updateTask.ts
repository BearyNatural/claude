/**
 * "A new version is available" while the app is closed (Android). A background
 * task — run by the phone about once a day when it chooses — checks the same
 * small version file as the banner (daily or weekly, from Garden Profile ›
 * General) and shows a notification once per new version. No server or push
 * service is involved: the app checks for itself.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { ENV } from '../env';
import { asyncStorageStore } from '../storage/asyncStorageStore';
import { GardenRepository } from '../storage/gardenRepository';
import { AppUpdates, UPDATE_CHECK_INTERVAL_MS } from './appUpdates';

export const UPDATE_CHECK_TASK = 'sow-by-season-update-check';
const CHANNEL = 'app-updates';
/** Minutes between runs requested from Android; the check itself is daily or weekly. */
const INTERVAL_MIN = 12 * 60;

/** Check once and notify about a new version. Returns true if a notification was shown. */
export async function runUpdateCheck(now = new Date()): Promise<boolean> {
  if (!ENV.plantDataToken) return false;
  const { data } = await new GardenRepository(asyncStorageStore).load();
  const updates = new AppUpdates(asyncStorageStore, ENV.appVersion, { fetch: (u, i) => fetch(u, i), now: () => now, token: ENV.plantDataToken });
  const release = await updates.check(false, UPDATE_CHECK_INTERVAL_MS[data.settings.updateChecks ?? 'daily']);
  if (!release) return false;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted || !(await updates.shouldNotify(release.version))) return false;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'App updates', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Sow by Season ${release.version} is available`,
      body: 'Tap to download it, then tap Install. Your garden is kept.',
      data: { url: release.url },
    },
    trigger: { channelId: CHANNEL } as Notifications.NotificationTriggerInput,
  });
  return true;
}

// Must be defined when the JavaScript bundle loads, so Android can run it without the app open.
TaskManager.defineTask(UPDATE_CHECK_TASK, async () => {
  try {
    await runUpdateCheck();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Make sure the background check is registered (only in builds that can check). */
export async function syncUpdateChecks(): Promise<void> {
  try {
    if (!ENV.plantDataToken) return;
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(UPDATE_CHECK_TASK))) await BackgroundTask.registerTaskAsync(UPDATE_CHECK_TASK, { minimumInterval: INTERVAL_MIN });
  } catch {
    // Not available on this phone; the banner in the app still works.
  }
}
