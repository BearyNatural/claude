import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureNotifications } from '../src/services/notifications/notificationService';
import { appStore, autoBackup } from '../src/state/appStore';
import { useAutoBackupRunner } from '../src/state/autoBackup';
import { StoreProvider, useGardenState, useGardenView, useReminderSync } from '../src/state/hooks';
import { CLIMATE_ZONES, seasonFor } from '../src/domain/climate';
import { buildWidgetSnapshot } from '../src/widget/snapshot';
import { pushWidgetSnapshot } from '../src/widget/widgetStore';
import { Loading, Notice, Screen, T } from '../src/ui/components/primitives';
import { usePalette } from '../src/ui/theme/theme';

/**
 * Browser version: the website's 404 page sends deep links back to the app as
 * "/garden/?to=/garden/plant/tomato" (static hosting has no per-page files).
 * Open the page they asked for.
 */
function WebDeepLink() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const to = new URLSearchParams(window.location.search).get('to');
    if (!to || !to.startsWith('/garden/')) return;
    const path = to.slice('/garden'.length);
    window.history.replaceState(null, '', `/garden${path}`);
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
