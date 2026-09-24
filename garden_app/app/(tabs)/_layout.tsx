import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { useGardenState } from '../../src/state/hooks';
import { usePalette } from '../../src/ui/theme/theme';

export default function TabsLayout() {
  const { data } = useGardenState();
  const p = usePalette();
  if (!data.profile?.onboardingComplete) return <Redirect href="/onboarding" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.textMuted,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        headerStyle: { backgroundColor: p.bg },
        headerTitleStyle: { color: p.text },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'This Week', headerShown: false, tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="plant-now" options={{ title: 'Plant Now', tabBarIcon: icon('leaf-outline') }} />
      <Tabs.Screen name="garden" options={{ title: 'My Garden', tabBarIcon: icon('flower-outline') }} />
      <Tabs.Screen name="plants" options={{ title: 'Plants', tabBarIcon: icon('search-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu-outline') }} />
    </Tabs>
  );
}
