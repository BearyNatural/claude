/**
 * Runs when Android asks the widget to draw (added, periodic update, resized).
 * Reads the summary the app saved last time — it never loads the whole garden.
 */
import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { ThisWeekWidget, WIDGET_NAME } from './ThisWeekWidget';
import { readWidgetSnapshot, widgetToday } from './widgetStore';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
  const snapshot = await readWidgetSnapshot();
  const today = widgetToday(snapshot?.timezone);
  props.renderWidget({
    light: <ThisWeekWidget snapshot={snapshot} today={today} theme="light" />,
    dark: <ThisWeekWidget snapshot={snapshot} today={today} theme="dark" />,
  });
}
