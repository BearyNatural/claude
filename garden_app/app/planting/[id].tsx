/**
 * Planting detail: timeline (estimates replaced by real observations),
 * recording events and journal notes, stage override, editing and removal.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { formatDay } from '../../src/domain/dates';
import { buildTimeline, describeProgress, STAGE_LABELS } from '../../src/domain/timeline';
import type { GrowthStage, PlantingEventType } from '../../src/domain/types';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { DateField, InfoTip, TimelineList } from '../../src/ui/components/garden';
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, Screen, Section, Stepper, T } from '../../src/ui/components/primitives';
import { METHOD_LABELS } from '../../src/ui/labels';
import { space } from '../../src/ui/theme/theme';

const EVENTS: { type: PlantingEventType; label: string }[] = [
  { type: 'germinated', label: 'Germinated' },
  { type: 'transplanted', label: 'Transplanted' },
  { type: 'first-flower', label: 'First flowers' },
  { type: 'fruit-set', label: 'Fruit set' },
  { type: 'first-harvest', label: 'First harvest' },
  { type: 'harvest', label: 'Harvested' },
  { type: 'finished', label: 'Finished' },
  { type: 'failed', label: 'Failed' },
  { type: 'removed', label: 'Removed' },
];

const STAGES: GrowthStage[] = ['seed', 'germinating', 'seedling', 'transplanted', 'established', 'flowering', 'fruiting', 'harvesting', 'dormant', 'finished', 'failed', 'removed'];

export default function PlantingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, today, store } = useGardenView();
  const p = data.plantings.find((x) => x.id === id);
  const plant = p ? getPlant(p.plantId) : undefined;
  const tl = useMemo(() => (p ? buildTimeline(p, plant, data.journal, today) : null), [p, plant, data.journal, today]);
  const [eventType, setEventType] = useState<PlantingEventType | null>(null);
  const [eventDate, setEventDate] = useState(today);
  const [eventNote, setEventNote] = useState('');
  const [note, setNote] = useState('');
  const [noteDate, setNoteDate] = useState(today);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(p?.quantity ?? 1);
  const [variety, setVariety] = useState(p?.variety ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [startDate, setStartDate] = useState(today);

  if (!p || !tl) return <EmptyState title="Planting not found" body="It may have been deleted." />;
  const area = data.areas.find((a) => a.id === p.areaId);
  const name = plant?.commonName ?? p.plantId;

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <View style={{ gap: 4 }}>
        <T variant="title">{`${name}${p.variety ? ` '${p.variety}'` : ''}`}</T>
        <T variant="small" muted>
          {[`${p.quantity} × ${METHOD_LABELS[p.startMethod].toLowerCase()}`, area?.name, `${p.stage === 'planned' ? 'planned for' : 'started'} ${formatDay(p.plantedDate, today)}${p.dateAccuracy !== 'exact' ? ' (approx.)' : ''}`].filter(Boolean).join(' · ')}
        </T>
        <Row wrap gap={6}>
          <Badge tone="good" icon="leaf-outline" label={STAGE_LABELS[tl.estimatedStage]} />
          <Badge tone={p.stageIsManual ? 'info' : 'neutral'} label={p.stageIsManual ? 'Stage set by you' : 'Stage estimated'} />
          {p.system ? <Badge tone="earth" icon="git-network-outline" label="Three Sisters" /> : null}
        </Row>
      </View>

      {p.stage === 'planned' ? (
        <Card tone="info">
          <T variant="h3">Planned</T>
          {p.notes ? <T variant="small">{p.notes}</T> : null}
          <DateField label="Sown / planted on" value={startDate} onChange={setStartDate} />
          <Button icon="checkmark" label="Mark as sown / planted" onPress={() => void store.markStarted(p.id, startDate)} />
        </Card>
      ) : (
        <Notice tone="info" icon="analytics-outline">{`${describeProgress(tl)}. Dashed markers are estimates — they update when you record what actually happens.`}</Notice>
      )}

      {p.successionPlanId ? <Button variant="secondary" icon="repeat" label="Open succession plan" onPress={() => router.push(`/succession/${p.successionPlanId}`)} /> : null}

      <Section title="Timeline">
        <Card>
          <TimelineList items={tl.items} today={today} />
          {tl.uncertaintyDays ? <T variant="tiny" muted>{`Because the planting date is approximate, estimates are widened by about ±${tl.uncertaintyDays} days.`}</T> : null}
          {!plant?.timing && p.stage !== 'planned' ? <T variant="tiny" muted>We don&apos;t have timing data for this plant, so there are no estimates yet.</T> : null}
        </Card>
      </Section>

      {p.stage !== 'planned' ? (
        <Section title="Record what happened">
          <Row wrap>
            {EVENTS.map((e) => (
              <Chip key={e.type} label={e.label} selected={eventType === e.type} onPress={() => setEventType(eventType === e.type ? null : e.type)} />
            ))}
          </Row>
          {eventType ? (
            <Card>
              <DateField label="When?" value={eventDate} onChange={setEventDate} />
              <Field label="Note (optional)" value={eventNote} onChangeText={setEventNote} />
              <Button
                icon="checkmark"
                label="Record"
                onPress={async () => {
                  await store.addEvent(p.id, eventType, eventDate, eventNote);
                  setEventType(null);
                  setEventNote('');
                }}
              />
            </Card>
          ) : null}
        </Section>
      ) : null}

      <Section title="Journal note" subtitle='e.g. "aphids noticed", "added compost"'>
        <Field label="Note" value={note} onChangeText={setNote} multiline />
        <DateField label="Date" value={noteDate} onChange={setNoteDate} />
        <Button
          variant="secondary"
          icon="create-outline"
          label="Add to journal"
          disabled={!note.trim()}
          onPress={async () => {
            await store.addJournal(note, noteDate, { plantingId: p.id, areaId: p.areaId });
            setNote('');
          }}
        />
      </Section>

      {p.stage !== 'planned' ? (
        <Section title="Growth stage">
          <Row gap={4}>
            <T variant="small" muted style={{ flex: 1 }}>Normally estimated from dates and your records. Set it yourself if it&apos;s wrong.</T>
            <InfoTip termId="transplant" />
          </Row>
          <Row wrap>
            <Chip label="Estimate for me" selected={!p.stageIsManual} onPress={() => void store.setStage(p.id, 'auto')} />
            {STAGES.map((s) => (
              <Chip key={s} label={STAGE_LABELS[s]} selected={p.stageIsManual && p.stage === s} onPress={() => void store.setStage(p.id, s)} />
            ))}
          </Row>
        </Section>
      ) : null}

      <Section title="Details" action={<Button compact variant="ghost" label={editing ? 'Cancel' : 'Edit'} onPress={() => setEditing((e) => !e)} />}>
        {editing ? (
          <Card>
            <Stepper label="Quantity" value={qty} onChange={setQty} min={1} max={10000} />
            <Field label="Variety" value={variety} onChangeText={setVariety} />
            <Button
              label="Save changes"
              onPress={async () => {
                await store.savePlanting({ ...p, quantity: qty, variety: variety.trim() || undefined });
                setEditing(false);
              }}
            />
          </Card>
        ) : (
          <Card>
            <T variant="small">{p.notes ?? 'No notes.'}</T>
            {plant ? <Button compact variant="ghost" icon="information-circle-outline" label={`About ${plant.commonName.toLowerCase()}`} onPress={() => router.push(`/plant/${plant.id}`)} /> : null}
          </Card>
        )}
      </Section>

      {confirmDelete ? (
        <Card tone="danger">
          <T variant="h3">Delete this planting?</T>
          <T variant="small">Its timeline and linked journal notes will be removed. This can&apos;t be undone (unless you restore a backup). To keep the history, record it as Finished or Removed instead.</T>
          <Row gap={space.sm}>
            <Button variant="danger" label="Delete" onPress={async () => { await store.deletePlanting(p.id); router.back(); }} />
            <Button variant="secondary" label="Keep it" onPress={() => setConfirmDelete(false)} />
          </Row>
        </Card>
      ) : (
        <Button variant="ghost" icon="trash-outline" label="Delete planting" onPress={() => setConfirmDelete(true)} />
      )}
    </Screen>
  );
}
