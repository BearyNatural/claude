import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureNotifications } from '../src/services/notifications/notificationService';
import { appStore } from '../src/state/appStore';
import { StoreProvider, useGardenState, useReminderSync } from '../src/state/hooks';
import { Loading, Notice, Screen, T } from '../src/ui/components/primitives';
import { usePalette } from '../src/ui/theme/theme';

function ReminderSync() {
  useReminderSync();
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
        <Stack.Screen name="planting/new" options={{ title: 'Add a planting', presentation: 'modal' }} />
        <Stack.Screen name="planting/[id]" options={{ title: 'Planting' }} />
        <Stack.Screen name="area/edit" options={{ title: 'Garden area', presentation: 'modal' }} />
        <Stack.Screen name="area/[id]" options={{ title: 'Garden area' }} />
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
