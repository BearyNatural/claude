/**
 * Manage a succession plan: accept, postpone, skip, change quantity or stop.
 * Every action recalculates the remaining sowings within the planting window.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDay } from '../../src/domain/dates';
import { describeInterval } from '../../src/domain/succession';
import type { SuccessionBatch } from '../../src/domain/types';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { Badge, Button, Card, Chip, EmptyState, Notice, Row, Screen, Section, Stepper, T } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

function BatchCard({ planId, b, isNext }: { planId: string; b: SuccessionBatch; isNext: boolean }) {
  const { store, today } = useGardenView();
  const [qty, setQty] = useState(b.quantity);
  const [editing, setEditing] = useState(false);
  const [future, setFuture] = useState(true);
  const status = b.status === 'accepted' ? { tone: 'good' as const, label: 'Sown', icon: 'checkmark' as const } : b.status === 'skipped' ? { tone: 'neutral' as const, label: 'Skipped', icon: 'play-skip-forward' as const } : { tone: 'info' as const, label: isNext ? 'Next' : 'Planned', icon: 'time-outline' as const };
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="h3">{`${formatDay(b.plannedDate, today)} — about ${b.quantity}`}</T>
        <Badge tone={status.tone} icon={status.icon} label={status.label} />
      </Row>
      {b.status === 'accepted' && b.plantingId ? <Button compact variant="ghost" label="Open planting" onPress={() => router.push(`/planting/${b.plantingId}`)} /> : null}
      {b.status === 'planned' ? (
        <>
          <Row wrap gap={space.sm}>
            <Button compact icon="checkmark" label="Sown today" onPress={() => void store.acceptSuccessionBatch(planId, b.index, today, qty)} />
            <Button compact variant="secondary" icon="calendar-outline" label="Postpone a week" onPress={() => void store.postponeSuccessionBatch(planId, b.index, 7)} />
            <Button compact variant="secondary" icon="play-skip-forward-outline" label="Skip" onPress={() => void store.skipSuccessionBatch(planId, b.index)} />
            <Button compact variant="ghost" icon="create-outline" label="Change amount" onPress={() => setEditing((e) => !e)} />
          </Row>
          {editing ? (
            <View style={{ gap: space.sm }}>
              <Stepper label="Quantity" value={qty} onChange={setQty} min={1} max={10000} />
              <Chip label="Also use for later sowings" selected={future} onPress={() => setFuture((f) => !f)} />
              <Button compact label="Save amount" onPress={async () => { await store.setSuccessionQuantity(planId, b.index, qty, future); setEditing(false); }} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function SuccessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, store } = useGardenView();
  const [confirmStop, setConfirmStop] = useState(false);
  const plan = data.successionPlans.find((s) => s.id === id);
  if (!plan) return <EmptyState title="Plan not found" />;
  const plant = getPlant(plan.plantId);
  const next = plan.batches.filter((b) => b.status === 'planned').sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1))[0];
  return (
    <Screen>
      <Stack.Screen options={{ title: `${plant?.commonName ?? 'Succession'} plan` }} />
      <T variant="title">{plant?.commonName ?? plan.plantId}</T>
      <Row wrap gap={6}>
        <Badge tone={plan.status === 'active' ? 'good' : 'neutral'} label={plan.status === 'active' ? 'Active' : plan.status === 'stopped' ? 'Stopped' : 'Season complete'} />
        <Badge tone="info" icon="repeat" label={`Every ${describeInterval(plan.intervalDays)}`} />
        <Badge label={`~${plan.defaultBatchQuantity} per sowing`} />
      </Row>
      {plan.notes.map((n, i) => (
        <T key={i} variant="tiny" muted>{n}</T>
      ))}
      <Notice tone="info">Quantities are planning estimates. Change them to suit how much you actually eat.</Notice>
      <Section title="Sowings">
        {plan.batches.map((b) => (
          <BatchCard key={`${b.index}-${b.plannedDate}`} planId={plan.id} b={b} isNext={b === next} />
        ))}
        {plan.batches.length === 0 ? <T variant="small" muted>No sowings left in this season&apos;s window.</T> : null}
      </Section>
      {plan.status === 'active' ? (
        confirmStop ? (
          <Card tone="caution">
            <T variant="small">Stop this plan? Sowings you&apos;ve already made stay in your garden; future ones are removed.</T>
            <Row gap={space.sm}>
              <Button variant="danger" label="Stop plan" onPress={() => void store.stopSuccession(plan.id)} />
              <Button variant="secondary" label="Keep going" onPress={() => setConfirmStop(false)} />
            </Row>
          </Card>
        ) : (
          <Button variant="ghost" icon="stop-circle-outline" label="Stop succession planting" onPress={() => setConfirmStop(true)} />
        )
      ) : (
        <Button variant="ghost" icon="trash-outline" label="Delete this plan" onPress={async () => { await store.deleteSuccession(plan.id); router.back(); }} />
      )}
    </Screen>
  );
}
