/**
 * Local notifications via expo-notifications.
 *
 * Reminders are planned by the domain (planReminders) and scheduled here as
 * one-off DATE triggers. We re-plan and reschedule every time the app starts,
 * returns to the foreground, or garden data changes.
 *
 * Honest limitations (also in docs/ARCHITECTURE.md):
 *  - The OS does not guarantee background execution, so reminders reflect the
 *    garden and forecast as they were when the app was last opened. A frost
 *    forecast that appears after that won't produce a reminder until the app
 *    is opened again.
 *  - iOS allows at most 64 pending local notifications; we schedule well below that.
 *  - Local notifications are not available on web.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PlannedReminder } from '../../domain/reminders';

const CHANNEL_ID = 'garden-reminders';
const MAX_SCHEDULED = 30;

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export function notificationsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

let handlerSet = false;
export function configureNotifications(): void {
  if (!notificationsSupported() || handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function getPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  const s = await Notifications.getPermissionsAsync();
  if (s.granted) return 'granted';
  return s.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Garden reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const s = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } });
  return s.granted ? 'granted' : 'denied';
}

function toDate(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0); // device-local time
}

/** Replace all scheduled reminders with the given plan. Returns the number scheduled. */
export async function scheduleReminders(plan: readonly PlannedReminder[]): Promise<number> {
  if (!notificationsSupported()) return 0;
  const perm = await getPermission();
  if (perm !== 'granted') return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  let count = 0;
  for (const r of plan.slice(0, MAX_SCHEDULED)) {
    const when = toDate(r.date, r.time);
    if (when.getTime() <= now + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: r.title, body: r.body, data: { taskIds: r.taskIds } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL_ID },
    });
    count++;
  }
  return count;
}

export async function cancelAllReminders(): Promise<void> {
  if (!notificationsSupported()) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
