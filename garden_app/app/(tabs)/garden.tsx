/**
 * My Garden — "What is happening in my garden?"
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { formatDay } from '../../src/domain/dates';
import { areaUsage, isActive, overcrowdingWarning } from '../../src/domain/space';
import { nextPlannedBatch } from '../../src/domain/succession';
import { buildTimeline, describeProgress, STAGE_LABELS } from '../../src/domain/timeline';
import type { Planting } from '../../src/domain/types';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { Badge, Button, Card, EmptyState, ListRow, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { AREA_TYPE_LABELS } from '../../src/ui/forms/areaForm';
import { space, usePalette } from '../../src/ui/theme/theme';
import { isInArea } from '../../src/domain/plantingAreas';
import { latestPhotoUri } from '../../src/ui/components/photos';

function UsageBar({ ratio }: { ratio: number }) {
  const p = usePalette();
  const pct = Math.min(1, ratio);
  const over = ratio > 1.1;
  return (
    <View accessible accessibilityLabel={`About ${Math.round(ratio * 100)}% of estimated space used${over ? ', crowded' : ''}`} style={{ gap: 2 }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: p.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: over ? p.caution : p.primary }} />
      </View>
      <T variant="tiny" muted>{`About ${Math.round(ratio * 100)}% of estimated space used${over ? ' — crowded' : ''}`}</T>
    </View>
  );
}

export default function Garden() {
  const { data, today, store } = useGardenView();
  const [showPast, setShowPast] = useState(false);

  const rows = useMemo(
    () =>
      data.plantings.map((p) => {
        const plant = getPlant(p.plantId);
        const tl = buildTimeline(p, plant, data.journal, today);
        return { p, plant, tl };
      }),
    [data.plantings, data.journal, today],
  );
  const active = rows.filter((r) => isActive({ ...r.p, stage: r.tl.estimatedStage }) && r.p.stage !== 'planned');
  const planned = rows.filter((r) => r.p.stage === 'planned');
  const past = rows.filter((r) => ['finished', 'removed', 'failed'].includes(r.tl.estimatedStage));
  const activeAreas = data.areas.filter((a) => !a.archived);

  const plantingRow = ({ p, plant, tl }: { p: Planting; plant: ReturnType<typeof getPlant>; tl: ReturnType<typeof buildTimeline> }) => (
    <ListRow
      key={p.id}
      icon="leaf-outline"
      imageUri={latestPhotoUri(p, store)}
      title={`${plant?.commonName ?? p.plantId}${p.variety ? ` '${p.variety}'` : ''} × ${p.quantity}`}
      subtitle={p.stage === 'planned' ? `Planned for ${formatDay(p.plantedDate, today)}${p.notes ? ` — ${p.notes}` : ''}` : describeProgress(tl)}
      onPress={() => router.push(`/planting/${p.id}`)}
    />
  );

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="small" muted style={{ flex: 1 }}>What&apos;s growing, where, and what happens next.</T>
        <Button compact icon="add" label="Add planting" onPress={() => router.push('/planting/new')} />
      </Row>

      <Section
        title="Garden areas"
        action={
          <Row gap={0}>
            <Button compact variant="ghost" icon="map-outline" label="Map" onPress={() => router.push('/garden-map')} accessibilityHint="Optional: outline your garden beds on a satellite map to measure them" />
            <Button compact variant="ghost" icon="add" label="Add area" onPress={() => router.push('/area/edit')} />
          </Row>
        }
      >
        {activeAreas.length === 0 ? (
          <Card>
            <T variant="small" muted>Add your beds, pots and other spaces so we can check spacing, sun and room for new plants. A rough size is enough.</T>
          </Card>
        ) : (
          activeAreas.map((a) => {
            const u = areaUsage(a, data.plantings, getPlant);
            const count = data.plantings.filter((p) => isInArea(p, a.id) && isActive(p)).length;
            const warn = overcrowdingWarning(a, data.plantings, getPlant);
            return (
              <Card key={a.id} onPress={() => router.push(`/area/${a.id}`)} accessibilityLabel={`${a.name}, ${count} plantings`}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="h3">{a.name}</T>
                  <Badge label={AREA_TYPE_LABELS[a.type]} />
                </Row>
                <T variant="small" muted>
                  {[a.lengthM && a.widthM ? `${a.lengthM} × ${a.widthM} m` : null, a.sunHours !== undefined ? `${a.sunHours} h sun` : null, `${count} planting${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </T>
                {u.ratio !== null ? <UsageBar ratio={u.ratio} /> : null}
                {warn ? <Badge tone="caution" icon="alert-circle-outline" label="Looks crowded" /> : null}
              </Card>
            );
          })
        )}
      </Section>

      <Section title={`Growing now (${active.length})`}>
        {active.length ? (
          <Card>{active.map(plantingRow)}</Card>
        ) : (
          <EmptyState title="Nothing recorded yet" body="Tell the app what's already growing — even roughly, like 'a tomato planted around early September'." action={<Button label="Add what's growing" icon="add" onPress={() => router.push('/planting/new')} />} />
        )}
      </Section>

      {planned.length ? (
        <Section title="Planned">
          <Card>{planned.map(plantingRow)}</Card>
        </Section>
      ) : null}

      {data.successionPlans.some((s) => s.status === 'active') ? (
        <Section title="Succession plans">
          <Card>
            {data.successionPlans
              .filter((s) => s.status === 'active')
              .map((s) => {
                const next = nextPlannedBatch(s);
                return (
                  <ListRow
                    key={s.id}
                    icon="repeat-outline"
                    title={getPlant(s.plantId)?.commonName ?? s.plantId}
                    subtitle={next ? `Next: about ${next.quantity} on ${formatDay(next.plannedDate, today)}` : 'No more sowings this season'}
                    onPress={() => router.push(`/succession/${s.id}`)}
                  />
                );
              })}
          </Card>
        </Section>
      ) : null}

      <Section title="Plan & record">
        <Card>
          <ListRow icon="calendar-outline" title="Seasonal calendar" subtitle="Sowing, harvest and upcoming jobs by month" onPress={() => router.push('/calendar')} />
          <ListRow icon="git-network-outline" title="Three Sisters planting" subtitle="Corn, climbing beans and pumpkin, sequenced" onPress={() => router.push('/three-sisters')} />
          <ListRow icon="create-outline" title="Garden journal" subtitle={`${data.journal.length} note${data.journal.length === 1 ? '' : 's'}`} onPress={() => router.push('/journal')} />
          <ListRow icon="heart-outline" title="Wish list" subtitle={`${data.wishlist.length} plant${data.wishlist.length === 1 ? '' : 's'}`} onPress={() => router.push('/wishlist')} />
        </Card>
      </Section>

      {past.length ? (
        <Section title={`Past plantings (${past.length})`} action={<Button compact variant="ghost" label={showPast ? 'Hide' : 'Show'} onPress={() => setShowPast((s) => !s)} />}>
          {showPast ? (
            <Card>
              {past.map(({ p, plant }) => (
                <ListRow key={p.id} icon="archive-outline" title={plant?.commonName ?? p.plantId} subtitle={`${STAGE_LABELS[p.stage]} · planted ${formatDay(p.plantedDate, today)}`} onPress={() => router.push(`/planting/${p.id}`)} />
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}
      <View style={{ height: space.lg }} />
    </Screen>
  );
}
