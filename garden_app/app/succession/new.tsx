import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { effectiveZone } from '../../src/domain/climate';
import { formatDay } from '../../src/domain/dates';
import { productionLevelFromGoals } from '../../src/domain/production';
import { areaUsage } from '../../src/domain/space';
import { describeInterval, proposeSuccession } from '../../src/domain/succession';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { DateField, InfoTip, PlantPicker } from '../../src/ui/components/garden';
import { Button, Card, Chip, Notice, Row, Screen, T } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

export default function NewSuccession() {
  const params = useLocalSearchParams<{ plantId?: string; areaId?: string }>();
  const { store, profile, today, data, zone } = useGardenView();
  const [plantId, setPlantId] = useState(params.plantId);
  const [areaId, setAreaId] = useState<string | undefined>(params.areaId);
  const [start, setStart] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const plant = plantId ? getPlant(plantId) : undefined;
  const area = data.areas.find((a) => a.id === areaId);
  const free = area ? areaUsage(area, data.plantings, getPlant).freeM2 : null;

  const proposal = useMemo(
    () =>
      plant && profile
        ? proposeSuccession(plant, { zone: effectiveZone(profile.location), startDate: start, householdSize: profile.householdSize, level: productionLevelFromGoals(profile.goals), timeBudget: profile.timeBudget, freeAreaM2: free })
        : null,
    [plant, profile, start, free],
  );

  const create = async () => {
    if (!plantId) return;
    try {
      const plan = await store.createSuccessionPlan(plantId, areaId, start, free);
      router.replace(`/succession/${plan.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Row gap={4}>
        <T variant="h2">Plan repeated sowings</T>
        <InfoTip termId="succession-planting" />
      </Row>
      <T variant="small" muted>Small, regular sowings give a steady harvest instead of one big glut. The plan follows your local planting window and your household, space and time.</T>
      <PlantPicker value={plantId} onChange={setPlantId} zone={zone} today={today} />
      <T variant="small" style={{ fontWeight: '600' }}>Area (optional)</T>
      <Row wrap>
        <Chip label="No particular area" selected={!areaId} onPress={() => setAreaId(undefined)} />
        {data.areas.filter((a) => !a.archived).map((a) => (
          <Chip key={a.id} label={a.name} selected={areaId === a.id} onPress={() => setAreaId(a.id)} />
        ))}
      </Row>
      <DateField label="First sowing" value={start} onChange={setStart} />
      {proposal ? (
        proposal.suitable ? (
          <Card tone="good">
            <T variant="h3">{`About ${proposal.batchQuantity} ${proposal.unit} every ${describeInterval(proposal.intervalDays)}`}</T>
            {proposal.batches.map((b, i) => (
              <T key={b.date} variant="small">{`${i === 0 ? 'First' : `Batch ${i + 1}`}: ${formatDay(b.date, today)} — about ${b.quantity}`}</T>
            ))}
            {proposal.notes.map((n, i) => (
              <T key={i} variant="tiny" muted>{n}</T>
            ))}
          </Card>
        ) : (
          <Notice tone="caution">{proposal.reason ?? 'Not suitable.'}</Notice>
        )
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Create plan" icon="checkmark" disabled={!proposal?.suitable} onPress={create} style={{ marginTop: space.sm }} />
    </Screen>
  );
}
