/**
 * Saving the widget summary and redrawing the widget (Android only). The app
 * calls pushWidgetSnapshot when tasks or weather change; the widget's own task
 * handler (widgetTaskHandler.tsx) reads the saved summary when Android asks.
 */
import React from 'react';
import { Platform } from 'react-native';
import { todayInTimeZone } from '../domain/dates';
import { asyncStorageStore } from '../services/storage/asyncStorageStore';
import type { WidgetSnapshot } from './snapshot';
import { ThisWeekWidget, WIDGET_NAME } from './ThisWeekWidget';

const KEY = 'sbs:widget:snapshot';

export async function readWidgetSnapshot(): Promise<(WidgetSnapshot & { timezone?: string }) | null> {
  try {
    const raw = await asyncStorageStore.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

export function widgetToday(timezone?: string): string {
  return todayInTimeZone(timezone ?? 'Australia/Sydney', new Date());
}

let last = '';

export async function pushWidgetSnapshot(snapshot: WidgetSnapshot, timezone: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  const json = JSON.stringify({ ...snapshot, timezone });
  if (json === last) return;
  last = json;
  await asyncStorageStore.setItem(KEY, json).catch(() => undefined);
  try {
    const { requestWidgetUpdate } = await import('react-native-android-widget');
    const today = widgetToday(timezone);
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => ({
        light: <ThisWeekWidget snapshot={snapshot} today={today} theme="light" />,
        dark: <ThisWeekWidget snapshot={snapshot} today={today} theme="dark" />,
      }),
      widgetNotFound: () => undefined,
    });
  } catch {
    // No widget on the home screen, or widgets unavailable — nothing to do.
  }
}
