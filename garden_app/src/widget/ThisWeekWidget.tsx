/**
 * Android home-screen widget: this week's garden at a glance. Rendered by
 * react-native-android-widget from a WidgetSnapshot. Tapping opens the app.
 */
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from './snapshot';

export const WIDGET_NAME = 'ThisWeek';

const THEMES = {
  light: { bg: '#F6F4EE', card: '#FFFFFF', title: '#1F3A28', text: '#2B2B2B', muted: '#5F6B62', accent: '#2F6B3F', border: '#DCD7CA' },
  dark: { bg: '#111A14', card: '#18231C', title: '#BFE3C7', text: '#E8EDE9', muted: '#9BA89F', accent: '#8FD19E', border: '#34413A' },
} as const;

export function ThisWeekWidget({ snapshot, today, theme = 'light' }: { snapshot: WidgetSnapshot | null; today: string; theme?: 'light' | 'dark' }) {
  const c = THEMES[theme];
  const stale = !!snapshot && snapshot.date !== today;
  const s = snapshot;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Open Sow by Season"
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: c.bg, borderRadius: 20, padding: 14, flexGap: 6 }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget text={s?.title ?? 'Sow by Season'} maxLines={1} truncate="END" style={{ fontSize: 16, fontWeight: 'bold', color: c.title }} />
        <TextWidget text={s && !s.needsSetup ? s.subtitle : ''} maxLines={1} style={{ fontSize: 12, color: c.muted }} />
      </FlexWidget>
      {!s || s.needsSetup ? (
        <TextWidget text="Open Sow by Season to set up your garden." style={{ fontSize: 13, color: c.text }} />
      ) : (
        <>
          {s.weather ? <TextWidget text={s.weather} maxLines={1} truncate="END" style={{ fontSize: 12, color: c.muted }} /> : null}
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', backgroundColor: c.card, borderRadius: 12, padding: 10, flexGap: 3, borderWidth: 1, borderColor: c.border }}>
            {s.tasks.length ? (
              s.tasks.map((t, i) => <TextWidget key={i} text={`• ${t}`} maxLines={1} truncate="END" style={{ fontSize: 13, color: c.text }} />)
            ) : (
              <TextWidget text="Nothing pressing this week — enjoy the garden." maxLines={2} style={{ fontSize: 13, color: c.text }} />
            )}
            {s.moreTasks ? <TextWidget text={`+ ${s.moreTasks} more this week`} style={{ fontSize: 11, color: c.muted }} /> : null}
          </FlexWidget>
          {s.plantNow.length ? <TextWidget text={`Plant now: ${s.plantNow.join(', ')}`} maxLines={1} truncate="END" style={{ fontSize: 12, color: c.accent }} /> : null}
          {stale ? <TextWidget text="Open the app to refresh" style={{ fontSize: 11, color: c.muted }} /> : null}
        </>
      )}
    </FlexWidget>
  );
}
