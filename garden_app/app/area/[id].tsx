import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { COMPANIONS } from '../../src/data/companions';
import { areaCompanionNotes, EVIDENCE_LABELS } from '../../src/domain/companions';
import { formatDay } from '../../src/domain/dates';
import { areaCapacityM2, areaUsage, isActive, overcrowdingWarning } from '../../src/domain/space';
import { buildTimeline, describeProgress } from '../../src/domain/timeline';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { Badge, Button, Card, EmptyState, ListRow, Notice, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { AREA_TYPE_LABELS, soilAdvice } from '../../src/ui/forms/areaForm';
import { space } from '../../src/ui/theme/theme';
import { isInArea } from '../../src/domain/plantingAreas';

export default function AreaDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, today, store } = useGardenView();
  const [confirm, setConfirm] = useState(false);
  const area = data.areas.find((a) => a.id === id);
  if (!area) return <EmptyState title="Area not found" />;
  const plantings = data.plantings.filter((p) => isInArea(p, area.id));
  const active = plantings.filter((p) => isActive(p) || p.stage === 'planned');
  const usage = areaUsage(area, data.plantings, getPlant);
  const cap = areaCapacityM2(area);
  const crowd = overcrowdingWarning(area, data.plantings, getPlant);
  const companionNotes = areaCompanionNotes(area.id, data.plantings, getPlant, COMPANIONS);
  const tips = soilAdvice(area);
  const journal = data.journal.filter((j) => j.areaId === area.id).slice(0, 5);

  return (
    <Screen>
      <Stack.Screen options={{ title: area.name }} />
      <T variant="title">{area.name}</T>
      <Row wrap gap={6}>
        <Badge label={AREA_TYPE_LABELS[area.type]} />
        {cap !== null ? <Badge tone="info" icon="resize-outline" label={`~${cap.toFixed(cap < 1 ? 2 : 1)} m²`} /> : <Badge label="Size not set" />}
        {area.sunHours !== undefined ? <Badge tone="caution" icon="sunny-outline" label={`${area.sunHours} h sun`} /> : null}
        {area.soilType && area.soilType !== 'unknown' ? <Badge tone="earth" label={`${area.soilType.replace('-', ' ')} soil`} /> : null}
      </Row>
      {usage.ratio !== null ? <T variant="small" muted>{`Roughly ${Math.round(usage.ratio * 100)}% of the estimated space is in use${usage.freeM2 !== null ? ` (about ${usage.freeM2.toFixed(1)} m² free)` : ''}. Based on typical plant spacing.`}</T> : null}
      {crowd ? <Notice tone="caution" title="Looks crowded">{crowd}</Notice> : null}

      <Row gap={space.sm} wrap>
        <Button icon="add" label="Add planting here" onPress={() => router.push({ pathname: '/planting/new', params: { areaId: area.id } })} />
        <Button variant="secondary" icon="create-outline" label="Edit area" onPress={() => router.push({ pathname: '/area/edit', params: { id: area.id } })} />
      </Row>

      <Section title="Growing here">
        {active.length ? (
          <Card>
            {active.map((p) => {
              const plant = getPlant(p.plantId);
              return (
                <ListRow key={p.id} icon="leaf-outline" title={`${plant?.commonName ?? p.plantId} × ${p.quantity}`} subtitle={p.stage === 'planned' ? `Planned ${formatDay(p.plantedDate, today)}` : describeProgress(buildTimeline(p, plant, data.journal, today))} onPress={() => router.push(`/planting/${p.id}`)} />
              );
            })}
          </Card>
        ) : (
          <T variant="small" muted>Nothing recorded in this area yet.</T>
        )}
      </Section>

      {companionNotes.length ? (
        <Section title="Neighbours" subtitle="How the plants here get along.">
          <Card>
            {companionNotes.map((n, i) => (
              <T key={i} variant="small">
                {`${n.relation.effect === 'beneficial' ? '✓' : '!'} ${n.plants[0].commonName} + ${n.plants[1].commonName}: ${n.relation.note} (${EVIDENCE_LABELS[n.relation.evidence]})`}
              </T>
            ))}
          </Card>
        </Section>
      ) : null}

      {tips.length ? (
        <Section title="Soil tips">
          <Card>
            {tips.map((t, i) => (
              <T key={i} variant="small">{`• ${t}`}</T>
            ))}
          </Card>
        </Section>
      ) : null}

      {journal.length ? (
        <Section title="Recent notes">
          <Card>
            {journal.map((j) => (
              <T key={j.id} variant="small">{`${formatDay(j.date, today)} — ${j.text}`}</T>
            ))}
          </Card>
        </Section>
      ) : null}

      {confirm ? (
        <Card tone="danger">
          <T variant="h3">Remove this area?</T>
          <T variant="small">Plantings here keep their history but won&apos;t be linked to an area.</T>
          <Row gap={space.sm}>
            <Button variant="danger" label="Remove area" onPress={async () => { await store.deleteArea(area.id); router.back(); }} />
            <Button variant="secondary" label="Keep" onPress={() => setConfirm(false)} />
          </Row>
        </Card>
      ) : (
        <Button variant="ghost" icon="trash-outline" label="Remove area" onPress={() => setConfirm(true)} />
      )}
    </Screen>
  );
}
