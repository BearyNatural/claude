/**
 * This Week — "What should I do this week?"
 * Jobs generated from the actual garden, trimmed to the gardener's time.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { CLIMATE_ZONES, seasonFor } from '../../src/domain/climate';
import { formatDay } from '../../src/domain/dates';
import { SECTION_LABELS } from '../../src/domain/tasks';
import type { GardenTask, TaskSection } from '../../src/domain/types';
import { roundMinutes } from '../../src/domain/workload';
import { useGardenView } from '../../src/state/hooks';
import { BrandHeader, GardenBanner, GardenSwitcher, TaskCard, WeatherCard } from '../../src/ui/components/garden';
import { Badge, Button, Card, EmptyState, Notice, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { completeTask, deferToGardeningDay, snoozeTask } from '../../src/ui/taskActions';
import { space } from '../../src/ui/theme/theme';

const SECTION_ORDER: TaskSection[] = ['protect', 'harvest', 'plant', 'care', 'prepare'];

export default function ThisWeek() {
  const v = useGardenView();
  const { store, week, today, zone, profile, data, weather, weatherState, plantNow } = v;
  const [showLater, setShowLater] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const season = seasonFor(today, zone);

  const act = async (t: GardenTask, fn: () => Promise<unknown>) => {
    setBusy(t.id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const renderTask = (t: GardenTask) => (
    <TaskCard
      key={t.id}
      task={t}
      onDone={() => act(t, () => completeTask(store, t, today))}
      onSnooze={() => act(t, () => snoozeTask(store, t, today))}
      onSkip={() => act(t, () => store.respondToTask(t.id, 'skipped'))}
      onIrrelevant={() => act(t, () => store.respondToTask(t.id, 'irrelevant'))}
      onNextGardeningDay={!t.timeCritical && (profile?.reminders.gardeningDays.length ?? 0) > 0 ? () => act(t, () => deferToGardeningDay(store, t, today, profile!.reminders.gardeningDays)) : undefined}
      onOpen={t.plantingId ? () => router.push(`/planting/${t.plantingId}`) : t.successionPlanId ? () => router.push(`/succession/${t.successionPlanId}`) : t.plantId ? () => router.push(`/plant/${t.plantId}`) : undefined}
    />
  );

  const bySection = (tasks: GardenTask[]) =>
    SECTION_ORDER.map((s) => ({ s, items: tasks.filter((t) => t.section === s) })).filter((g) => g.items.length);

  const topNow = plantNow.groups.find((g) => g.category === 'great')?.items.slice(0, 4) ?? [];

  return (
    <Screen safeTop>
      <View style={{ gap: 4 }}>
        <BrandHeader compact />
      </View>
      {v.state.appUpdate ? (
        <Notice
          tone="info"
          icon="arrow-up-circle-outline"
          title={`Sow by Season ${v.state.appUpdate.version} is available`}
          action={<Button compact icon="download-outline" label="Download" onPress={() => void Linking.openURL(v.state.appUpdate!.url)} />}
        >
          Opens the release page. Download the new file and tap Install — your garden data is kept.
        </Notice>
      ) : null}
      <GardenBanner
        title={`${season.label} in ${profile?.location.suburb ?? 'your garden'}`}
        subtitle={`${formatDay(today)}${zone ? ` · ${CLIMATE_ZONES[zone].name}` : ''}${v.gardens.length > 1 ? ` · ${v.garden?.name}` : ''}`}
      />
      <GardenSwitcher gardens={v.gardens} activeId={v.garden?.id} onSwitch={(id) => void v.store.setActiveGarden(id)} />

      {v.state.problems.length ? (
        <Notice tone="caution" title="Some saved records couldn't be read">
          {`${v.state.problems.length} record${v.state.problems.length > 1 ? 's were' : ' was'} damaged and set aside so the rest of your garden could open. Nothing else was affected. If something is missing, you can restore a backup from More › Backup & restore.`}
        </Notice>
      ) : null}

      <WeatherCard w={weather} zone={zone} loading={weatherState.loading} error={weatherState.error} onRefresh={data.settings.weatherEnabled ? () => store.refreshWeather(true) : undefined} needsLocation={weatherState.needsLocation} onSetLocation={() => router.push('/profile')} />

      <Card tone="good">
        <T variant="h3">{week.summary}</T>
        <Row wrap gap={6}>
          <Badge tone="good" icon="time-outline" label={`Your weekly time: about ${roundMinutes(week.budgetMinutes)}`} />
          {week.overBudget ? <Badge tone="caution" icon="alert-circle-outline" label="A busier week — essentials first" /> : null}
        </Row>
      </Card>

      {week.timeCritical.length ? (
        <Section title="Don't leave these" subtitle="Weather and new plantings can't wait for your gardening day.">
          {week.timeCritical.map(renderTask)}
        </Section>
      ) : null}

      {week.focus.length ? (
        bySection(week.focus).map(({ s, items }) => (
          <Section key={s} title={SECTION_LABELS[s]}>
            {items.map(renderTask)}
          </Section>
        ))
      ) : !week.timeCritical.length ? (
        <EmptyState
          icon="sunny-outline"
          title={data.plantings.length ? 'Nothing pressing this week' : 'Your garden is ready for its first planting'}
          body={data.plantings.length ? 'Enjoy the garden. New jobs will appear as your plants grow.' : 'Add what you are already growing, or see what you can plant now.'}
          action={
            <Row gap={space.sm} wrap style={{ justifyContent: 'center' }}>
              <Button label="Add a planting" icon="add" onPress={() => router.push('/planting/new')} />
              <Button variant="secondary" label="What can I plant?" onPress={() => router.push('/plant-now')} />
            </Row>
          }
        />
      ) : null}

      {week.oneHour.length && week.focus.length + week.timeCritical.length > week.oneHour.length ? (
        <Card>
          <T variant="h3">If you only have one hour, prioritise:</T>
          {week.oneHour.map((t, i) => (
            <T key={t.id} variant="small">{`${i + 1}. ${t.title}`}</T>
          ))}
          <T variant="tiny" muted>Lower-priority work can move to another day.</T>
        </Card>
      ) : null}

      {week.later.length ? (
        <Section title="Can wait" subtitle={`${week.later.length} lower-priority job${week.later.length > 1 ? 's' : ''} that don't fit this week's time — no pressure.`}
          action={<Button compact variant="ghost" label={showLater ? 'Hide' : 'Show'} onPress={() => setShowLater((s) => !s)} />}>
          {showLater ? week.later.map(renderTask) : null}
        </Section>
      ) : null}

      {topNow.length ? (
        <Section title="Good to plant now" action={<Button compact variant="ghost" label="See all" onPress={() => router.push('/plant-now')} />}>
          <Row wrap gap={6}>
            {topNow.map((r) => (
              <Button key={r.plant.id} compact variant="secondary" label={r.plant.commonName} onPress={() => router.push(`/plant/${r.plant.id}`)} />
            ))}
          </Row>
        </Section>
      ) : null}
      {busy ? <T variant="tiny" muted>Saving…</T> : null}
    </Screen>
  );
}
