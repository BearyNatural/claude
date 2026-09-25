/**
 * Add a planting — something already growing, just sown, or planned.
 * Checks (season, space, sun, pots, rotation, companions) are advice only;
 * the gardener can always save.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { COMPANIONS } from '../../src/data/companions';
import { areaCompanionNotes, EVIDENCE_LABELS } from '../../src/domain/companions';
import { diffDays, formatDay } from '../../src/domain/dates';
import { estimateQuantity, formatRange, productionLevelFromGoals } from '../../src/domain/production';
import { rotationWarnings } from '../../src/domain/rotation';
import { checkFit, containerCheck, sunCheck } from '../../src/domain/space';
import { toAreaIds } from '../../src/domain/plantingAreas';
import { isSuccessionSuited } from '../../src/domain/succession';
import type { DateAccuracy, GrowthStage, Planting, StartMethod } from '../../src/domain/types';
import { describeMonths, primaryWindow, windowPosition } from '../../src/domain/windows';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { DateField, InfoTip, PlantPicker } from '../../src/ui/components/garden';
import { Button, Chip, Choice, Field, Notice, Row, Screen, Stepper, T } from '../../src/ui/components/primitives';
import { AreaPicker, resolveAreaIds, useSelectNewAreas, type NewPot } from '../../src/ui/forms/areaPicker';
import { METHOD_LABELS } from '../../src/ui/labels';
import { space } from '../../src/ui/theme/theme';


const STAGE_CHOICES: GrowthStage[] = ['seed', 'germinating', 'seedling', 'transplanted', 'established', 'flowering', 'fruiting', 'harvesting', 'dormant'];

export default function NewPlanting() {
  const params = useLocalSearchParams<{ plantId?: string; areaId?: string; method?: string }>();
  const { store, today, zone, profile, data } = useGardenView();
  const [plantId, setPlantId] = useState<string | undefined>(params.plantId);
  const plant = plantId ? getPlant(plantId) : undefined;
  const [status, setStatus] = useState<'now' | 'planned'>('now');
  const [method, setMethod] = useState<StartMethod | undefined>((params.method as StartMethod) ?? plant?.startMethods[0]);
  const [areaIds, setAreaIds] = useState<string[]>(params.areaId ? [params.areaId] : []);
  const [newPot, setNewPot] = useState<NewPot>({ enabled: false });
  useSelectNewAreas(data.areas, useCallback((ids: string[]) => setAreaIds((cur) => [...cur, ...ids]), []));
  const [variety, setVariety] = useState('');
  const [date, setDate] = useState(today);
  const [accuracy, setAccuracy] = useState<DateAccuracy>('exact');
  const [stage, setStage] = useState<GrowthStage | 'auto'>('auto');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useMemo(
    () => (plant ? estimateQuantity(plant, { householdSize: profile?.householdSize ?? 1, level: productionLevelFromGoals(profile?.goals ?? []), timeBudget: profile?.timeBudget ?? '1to2' }) : null),
    [plant, profile],
  );
  const [qty, setQty] = useState<number>(estimate ? Math.round((estimate.range[0] + estimate.range[1]) / 2) : 1);
  const effMethod = method ?? plant?.startMethods[0] ?? 'seedling';

  const checks = useMemo(() => {
    if (!plant) return [] as { tone: 'caution' | 'info' | 'good'; text: string }[];
    const out: { tone: 'caution' | 'info' | 'good'; text: string }[] = [];
    const win = primaryWindow(plant, zone);
    if (win) {
      const pos = windowPosition(win.months, date);
      out.push(pos.inWindow ? { tone: 'good', text: `${formatDay(date)} is within the recommended period for your area (${describeMonths(win.months)}).` } : { tone: 'caution', text: `${formatDay(date)} is outside the usual period for your area (${describeMonths(win.months)}). That's your call — it may still work, especially in a sheltered spot.` });
    }
    const chosen = data.areas.filter((a) => areaIds.includes(a.id));
    // Plants are shared evenly between the chosen areas (a new pot counts as one).
    const share = Math.max(1, Math.round(qty / Math.max(1, chosen.length + (newPot.enabled ? 1 : 0))));
    for (const area of chosen) {
      const fit = checkFit(area, plant, share, data.plantings, getPlant);
      if (fit.fits === false && fit.message) out.push({ tone: 'caution', text: fit.message });
      const sun = sunCheck(area, plant);
      if (sun) out.push({ tone: 'caution', text: sun });
      const pot = containerCheck(area, plant);
      if (pot) out.push({ tone: 'caution', text: pot });
      for (const w of rotationWarnings(plant, area.id, data.plantings, getPlant, date)) out.push({ tone: 'info', text: w.message });
      const fake: Planting = { id: '__new', plantId: plant.id, quantity: share, areaIds: [area.id], startMethod: effMethod, plantedDate: date, dateAccuracy: accuracy, stage: 'established', stageIsManual: false, events: [], createdAt: '', updatedAt: '' };
      for (const n of areaCompanionNotes(area.id, [...data.plantings, fake], getPlant, COMPANIONS)) {
        if (!n.plants.some((p) => p.id === plant.id)) continue;
        const other = n.plants.find((p) => p.id !== plant.id)!;
        out.push({ tone: n.relation.effect === 'beneficial' ? 'good' : 'info', text: `${n.relation.effect === 'beneficial' ? 'Good neighbour' : 'Consider keeping apart'}: ${other.commonName} — ${n.relation.note} (${EVIDENCE_LABELS[n.relation.evidence]})` });
      }
    }
    if (newPot.enabled && share > 1) out.push({ tone: 'info', text: `That's about ${share} plants in the new pot. Most plants do best one to a pot unless it's large.` });
    return out;
  }, [plant, zone, date, areaIds, newPot.enabled, qty, data, effMethod, accuracy]);

  const save = async () => {
    if (!plant) return setError('Choose a plant first.');
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantity should be at least 1.');
    if (status === 'now' && diffDays(today, date) > 0) return setError('A planting that is already in the ground can\'t be dated in the future. Choose "Planned" instead.');
    setSaving(true);
    setError(null);
    try {
      const p = await store.savePlanting({
        plantId: plant.id,
        variety: variety.trim() || undefined,
        quantity: qty,
        areaIds: toAreaIds(await resolveAreaIds(store, plant.commonName, areaIds, newPot, data.areas)),
        startMethod: effMethod,
        plantedDate: date,
        dateAccuracy: status === 'planned' ? 'exact' : accuracy,
        stage: status === 'planned' ? 'planned' : stage === 'auto' ? (effMethod === 'direct-sow' || effMethod === 'seed-tray' ? 'seed' : 'transplanted') : stage,
        stageIsManual: status === 'now' && stage !== 'auto',
        notes: notes.trim() || undefined,
      });
      router.replace(`/planting/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <PlantPicker value={plantId} onChange={(id) => { setPlantId(id); const pl = getPlant(id); setMethod(pl?.startMethods[0]); const est = pl ? estimateQuantity(pl, { householdSize: profile?.householdSize ?? 1, level: productionLevelFromGoals(profile?.goals ?? []), timeBudget: profile?.timeBudget ?? '1to2' }) : null; if (est) setQty(Math.round((est.range[0] + est.range[1]) / 2)); }} zone={zone} today={today} />
      {plant ? (
        <>
          <Choice<'now' | 'planned'>
            options={[
              { value: 'now', label: 'Already sown or planted', description: 'Record something growing (or just sown).' },
              { value: 'planned', label: 'Planned', description: 'Something you intend to plant on a future date.' },
            ]}
            value={status}
            onChange={(s) => { setStatus(s); if (s === 'planned' && date <= today) setDate(today); }}
          />
          <View style={{ gap: space.sm }}>
            <T variant="small" style={{ fontWeight: '600' }}>How are you starting it?</T>
            <Row wrap>
              {(Object.keys(METHOD_LABELS) as StartMethod[])
                .filter((m) => plant.startMethods.includes(m) || m === 'seedling')
                .map((m) => (
                  <Chip key={m} label={METHOD_LABELS[m]} selected={effMethod === m} onPress={() => setMethod(m)} />
                ))}
            </Row>
          </View>
          <Field label="Variety (optional)" value={variety} onChangeText={setVariety} placeholder={plant.cultivars?.[0]?.name ?? 'e.g. Grosse Lisse'} />
          <Stepper label="How many plants?" value={qty} onChange={setQty} min={1} max={10000} />
          {estimate ? (
            <Row gap={4}>
              <T variant="tiny" muted style={{ flex: 1 }}>{`Suggested for your household: ${formatRange(estimate.range, estimate.unit)} (estimate).`}</T>
              {isSuccessionSuited(plant) ? <InfoTip termId="succession-planting" /> : null}
            </Row>
          ) : null}
          <AreaPicker areas={data.areas} value={areaIds} onChange={setAreaIds} newPot={newPot} onNewPotChange={setNewPot} />
          <DateField label={status === 'planned' ? 'Planned date' : 'Date sown or planted'} value={date} onChange={setDate} />
          {status === 'now' ? (
            <>
              <Choice<DateAccuracy>
                label="How sure are you of the date?"
                options={[
                  { value: 'exact', label: 'Exact' },
                  { value: 'approx-week', label: 'Within a week or so' },
                  { value: 'approx-month', label: 'Roughly — sometime around then', description: 'e.g. "sometime around early September". Estimates will show wider ranges.' },
                ]}
                value={accuracy}
                onChange={setAccuracy}
              />
              <View style={{ gap: space.sm }}>
                <T variant="small" style={{ fontWeight: '600' }}>Current stage</T>
                <Row wrap>
                  <Chip label="Work it out for me" selected={stage === 'auto'} onPress={() => setStage('auto')} />
                  {STAGE_CHOICES.map((s) => (
                    <Chip key={s} label={s[0].toUpperCase() + s.slice(1)} selected={stage === s} onPress={() => setStage(s)} />
                  ))}
                </Row>
              </View>
            </>
          ) : null}
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          {checks.map((c, i) => (
            <Notice key={i} tone={c.tone === 'good' ? 'good' : c.tone === 'caution' ? 'caution' : 'info'}>{c.text}</Notice>
          ))}
        </>
      ) : (
        <T variant="small" muted>Choose a plant to continue.</T>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save planting" icon="checkmark" onPress={save} loading={saving} disabled={!plant} />
    </Screen>
  );
}
