import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Linking, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureNotifications } from '../src/services/notifications/notificationService';
import { appStore, autoBackup } from '../src/state/appStore';
import { useAutoBackupRunner } from '../src/state/autoBackup';
import { StoreProvider, useGardenState, useGardenView, useReminderSync } from '../src/state/hooks';
import { CLIMATE_ZONES, seasonFor } from '../src/domain/climate';
import { syncWeatherAlerts } from '../src/services/alerts/backgroundAlerts';
import { syncUpdateChecks } from '../src/services/updates/updateTask';
import { WEB_BASE } from '../src/services/webBase';
import { buildWidgetSnapshot } from '../src/widget/snapshot';
import { pushWidgetSnapshot } from '../src/widget/widgetStore';
import { Loading, Notice, Screen, T } from '../src/ui/components/primitives';
import { usePalette } from '../src/ui/theme/theme';

/**
 * Browser version: the website's 404 page sends deep links back to the app as
 * "/sow-by-season/?to=/sow-by-season/plant/tomato" (static hosting has no
 * per-page files). Open the page they asked for.
 */
function WebDeepLink() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const to = new URLSearchParams(window.location.search).get('to');
    if (!to || !to.startsWith(`${WEB_BASE}/`)) return;
    const path = to.slice(WEB_BASE.length);
    window.history.replaceState(null, '', `${WEB_BASE}${path}`);
    if (/^\/[\w\-/[\]%.?=&]*$/.test(path) && path !== '/') router.replace(path as never);
  }, []);
  return null;
}

function ReminderSync() {
  useReminderSync();
  return null;
}

/** Keeps the Android home-screen widget in step with this week's garden. */
function WidgetSync() {
  const { today, zone, profile, weather, tasks, plantNow } = useGardenView();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const snapshot = buildWidgetSnapshot({
      today,
      hasProfile: !!profile?.onboardingComplete,
      seasonLabel: seasonFor(today, zone).label,
      suburb: profile?.location.suburb,
      zoneName: zone ? CLIMATE_ZONES[zone].name : undefined,
      weather,
      tasks,
      plantNowNames: (plantNow.groups.find((g) => g.category === 'great')?.items ?? []).map((r) => r.plant.commonName),
    });
    void pushWidgetSnapshot(snapshot, profile?.location.timezone ?? 'Australia/Sydney');
  }, [today, zone, profile, weather, tasks, plantNow]);
  return null;
}

/** Keeps the background weather-alert check registered (or not) to match the setting. */
function WeatherAlertSync() {
  const state = useGardenState();
  const on = !!state.data.settings.backgroundAlerts && state.data.settings.weatherEnabled;
  useEffect(() => {
    if (Platform.OS === 'android' && state.status === 'ready') void syncWeatherAlerts(on);
  }, [on, state.status]);
  return null;
}

const RELEASES = 'https://github.com/BearyNatural/claude/releases/';

/** Android: keep the background "new version" check registered, and open the download when its notification is tapped. */
function UpdateCheckSync() {
  const state = useGardenState();
  useEffect(() => {
    if (Platform.OS === 'android' && state.status === 'ready') void syncUpdateChecks();
  }, [state.status]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      if (typeof url !== 'string' || !url.startsWith(RELEASES)) return;
      Notifications.clearLastNotificationResponse(); // so reopening the app later doesn't open it again
      void Linking.openURL(url);
    };
    try {
      open(Notifications.getLastNotificationResponse());
    } catch {
      // Not available; taps while the app is running are still handled below.
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return null;
}

function AutoBackupRunner() {
  const state = useGardenState();
  useAutoBackupRunner(autoBackup, state.data);
  return null;
}

function Gate() {
  const state = useGardenState();
  const p = usePalette();
  useEffect(() => configureNotifications(), []);
  if (state.status === 'loading') return <Loading label="Opening your garden…" />;
  if (state.status === 'error') {
    return (
      <Screen>
        <T variant="title">Something went wrong</T>
        <Notice tone="danger" title="Your garden couldn't be opened">
          {`${state.loadError ?? 'Unknown error'}. Your saved data has not been deleted. Try closing and reopening the app. If this keeps happening, restore from a backup in Settings › Backup.`}
        </Notice>
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ReminderSync />
      <WebDeepLink />
      <AutoBackupRunner />
      <WidgetSync />
      <WeatherAlertSync />
      <UpdateCheckSync />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.bg },
          headerTintColor: p.primary,
          headerTitleStyle: { color: p.text },
          contentStyle: { backgroundColor: p.bg },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="plant/[id]" options={{ title: 'Plant' }} />
        <Stack.Screen name="plant/custom" options={{ title: 'Add a plant', presentation: 'modal' }} />
        <Stack.Screen name="planting/new" options={{ title: 'Add a planting', presentation: 'modal' }} />
        <Stack.Screen name="planting/[id]" options={{ title: 'Planting' }} />
        <Stack.Screen name="area/edit" options={{ title: 'Garden area', presentation: 'modal' }} />
        <Stack.Screen name="area/[id]" options={{ title: 'Garden area' }} />
        <Stack.Screen name="garden-map" options={{ title: 'Garden map' }} />
        <Stack.Screen name="gardens" options={{ title: 'Your gardens' }} />
        <Stack.Screen name="succession/new" options={{ title: 'Succession planting', presentation: 'modal' }} />
        <Stack.Screen name="succession/[id]" options={{ title: 'Succession plan' }} />
        <Stack.Screen name="three-sisters" options={{ title: 'Three Sisters' }} />
        <Stack.Screen name="calendar" options={{ title: 'Seasonal calendar' }} />
        <Stack.Screen name="wishlist" options={{ title: 'Wish list' }} />
        <Stack.Screen name="journal" options={{ title: 'Garden journal' }} />
        <Stack.Screen name="profile" options={{ title: 'Garden Profile' }} />
        <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
        <Stack.Screen name="backup" options={{ title: 'Backup & restore' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy & your data' }} />
        <Stack.Screen name="glossary" options={{ title: 'Gardening words' }} />
        <Stack.Screen name="about" options={{ title: 'About & sources' }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <StoreProvider store={appStore}>
        <Gate />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
