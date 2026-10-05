/**
 * Log a pest or problem: which plant, what you saw, how much — then the app
 * shows the remedies and reminds you to check again.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { PLANT_PROBLEMS } from '../../src/data/pests';
import { problemsFor, searchProblems } from '../../src/domain/pests';
import { isActive } from '../../src/domain/space';
import type { ISODate } from '../../src/domain/types';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { DateField, PlantPicker } from '../../src/ui/components/garden';
import { Button, Chip, Choice, Field, Notice, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

type Amount = 'few' | 'some' | 'lots';

export default function NewPestReport() {
  const params = useLocalSearchParams<{ plantingId?: string; plantId?: string; problemId?: string }>();
  const { data, today, store, zone } = useGardenView();
  const plantings = useMemo(() => data.plantings.filter((p) => isActive(p)), [data.plantings]);
  const [plantingId, setPlantingId] = useState<string | undefined>(params.plantingId);
  const [otherPlantId, setOtherPlantId] = useState<string | undefined>(params.plantingId ? undefined : params.plantId);
  const [pickOther, setPickOther] = useState(!!params.plantId && !params.plantingId);
  const [problemId, setProblemId] = useState<string | undefined>(params.problemId);
  const [otherName, setOtherName] = useState('');
  const [q, setQ] = useState('');
  const [seenOn, setSeenOn] = useState<ISODate>(today);
  const [amount, setAmount] = useState<Amount | undefined>();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const planting = plantingId ? data.plantings.find((p) => p.id === plantingId) : undefined;
  const plant = getPlant(planting?.plantId ?? otherPlantId ?? '');
  const likely = plant ? problemsFor(plant, PLANT_PROBLEMS) : [];
  const found = q.trim() ? searchProblems(q, PLANT_PROBLEMS) : [];
  const chosen = problemId && problemId !== 'other' ? PLANT_PROBLEMS.find((p) => p.id === problemId) : undefined;
  const label = (id: string) => {
    const p = data.plantings.find((x) => x.id === id)!;
    const pl = getPlant(p.plantId);
    return `${pl?.commonName ?? 'Plant'}${p.variety ? ` (${p.variety})` : ''}`;
  };

  const save = async () => {
    if (!problemId) return setError('Choose what you saw, or "Something else".');
    if (problemId === 'other' && !otherName.trim()) return setError('Say what you saw.');
    setSaving(true);
    setError(null);
    try {
      const saved = await store.savePestReport({
        plantingId,
        plantId: plantingId ? undefined : otherPlantId,
        problemId,
        otherName: problemId === 'other' ? otherName.trim() : undefined,
        seenOn,
        amount,
        notes: notes.trim() || undefined,
      });
      router.replace(`/pests/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Log a pest or problem' }} />
      <Section title="On which plant?" subtitle="Optional">
        <Row wrap>
          {plantings.map((p) => (
            <Chip key={p.id} label={label(p.id)} selected={plantingId === p.id} onPress={() => { setPlantingId(plantingId === p.id ? undefined : p.id); setPickOther(false); setOtherPlantId(undefined); }} />
          ))}
          <Chip label="Another plant" icon="search-outline" selected={pickOther} onPress={() => { setPickOther(!pickOther); setPlantingId(undefined); }} />
        </Row>
        {pickOther ? <PlantPicker value={otherPlantId} onChange={setOtherPlantId} zone={zone} today={today} /> : null}
      </Section>

      <Section title="What did you see?">
        {likely.length ? (
          <View style={{ gap: space.xs }}>
            <T variant="tiny" muted>{`Common on ${plant!.commonName.toLowerCase()}:`}</T>
            <Row wrap>
              {likely.map((p) => (
                <Chip key={p.id} label={p.name} selected={problemId === p.id} onPress={() => setProblemId(p.id)} />
              ))}
            </Row>
          </View>
        ) : null}
        <Field label="Search all pests and problems" value={q} onChangeText={setQ} placeholder="e.g. aphids, white powder, holes" />
        {found.length ? (
          <Row wrap>
            {found.slice(0, 12).map((p) => (
              <Chip key={p.id} label={p.name} selected={problemId === p.id} onPress={() => setProblemId(p.id)} />
            ))}
          </Row>
        ) : null}
        <Row wrap>
          <Chip label="Something else" icon="help-circle-outline" selected={problemId === 'other'} onPress={() => setProblemId('other')} />
          {chosen && !likely.includes(chosen) && !found.includes(chosen) ? <Chip label={chosen.name} selected onPress={() => undefined} /> : null}
        </Row>
        {problemId === 'other' ? <Field label="What is it?" value={otherName} onChangeText={setOtherName} placeholder="e.g. yellow leaves, possum damage" /> : null}
        {chosen ? <T variant="tiny" muted>{chosen.signs}</T> : null}
      </Section>

      <Section title="Details">
        <DateField label="When you saw it" value={seenOn} onChange={setSeenOn} />
        <Choice<Amount>
          label="How much?"
          options={[
            { value: 'few', label: 'Just a few' },
            { value: 'some', label: 'Some' },
            { value: 'lots', label: 'Lots — spreading' },
          ]}
          value={amount}
          onChange={setAmount}
        />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Where on the plant, what you tried…" />
        <T variant="tiny" muted>You can add photos on the next screen.</T>
      </Section>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button icon="checkmark" label="Save and see what to do" onPress={save} loading={saving} />
    </Screen>
  );
}
