/**
 * Pests & problems: what you've logged (newest first) and the pest guide.
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { PLANT_PROBLEMS } from '../../src/data/pests';
import { formatDay } from '../../src/domain/dates';
import { searchProblems } from '../../src/domain/pests';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { PROBLEM_KIND_LABEL } from '../../src/ui/components/pests';
import { Button, Card, EmptyState, Field, ListRow, Screen, Section, T } from '../../src/ui/components/primitives';

export default function Pests() {
  const { data, today, store } = useGardenView();
  const [q, setQ] = useState('');
  const reports = useMemo(() => [...data.pestReports].sort((a, b) => (a.seenOn < b.seenOn ? 1 : -1)), [data.pestReports]);
  const guide = useMemo(() => searchProblems(q, PLANT_PROBLEMS), [q]);
  const nameOf = (problemId: string, other?: string) => PLANT_PROBLEMS.find((p) => p.id === problemId)?.name ?? other ?? 'Something else';
  const plantName = (plantingId?: string, plantId?: string) => {
    const planting = plantingId ? data.plantings.find((x) => x.id === plantingId) : undefined;
    const plant = getPlant(planting?.plantId ?? plantId ?? '');
    return plant ? `${plant.commonName}${planting?.variety ? ` (${planting.variety})` : ''}` : undefined;
  };

  return (
    <Screen>
      <T variant="small" muted>Note pests and problems you spot, and get remedies — natural steps first, a chemical only as a last resort. This Week reminds you to check again.</T>
      <Button icon="add" label="Log a pest or problem" onPress={() => router.push('/pests/new')} />
      <Section title="What you've logged">
        {reports.length ? (
          <Card>
            {reports.map((r) => {
              const photo = [...(r.photos ?? [])].reverse().find((ph) => store.photoExists(ph.file));
              const on = plantName(r.plantingId, r.plantId);
              return (
                <ListRow
                  key={r.id}
                  icon="bug-outline"
                  imageUri={photo ? store.photoUri(photo.file) : undefined}
                  title={nameOf(r.problemId, r.otherName)}
                  subtitle={`${on ? `${on} · ` : ''}${formatDay(r.seenOn, today)}${r.amount ? ` · ${r.amount === 'lots' ? 'lots' : r.amount === 'some' ? 'some' : 'a few'}` : ''}`}
                  onPress={() => router.push(`/pests/${r.id}`)}
                />
              );
            })}
          </Card>
        ) : (
          <EmptyState icon="bug-outline" title="Nothing logged" body="When you spot a pest or a problem on a plant, log it here (or from the planting) to get remedies and a reminder to check again." />
        )}
      </Section>
      <Section title="Pest & problem guide" subtitle={`${PLANT_PROBLEMS.length} common pests, diseases and growing problems`}>
        <Field label="Search the guide" value={q} onChangeText={setQ} placeholder="e.g. aphids, white powder, holes in leaves" />
        <Card>
          {guide.map((p) => (
            <ListRow key={p.id} icon={p.kind === 'disease' || p.kind === 'disorder' ? 'medkit-outline' : 'bug-outline'} title={p.name} subtitle={PROBLEM_KIND_LABEL[p.kind]} onPress={() => router.push(`/problem/${p.id}`)} />
          ))}
          {!guide.length ? <T variant="small" muted>Nothing matches — try another word, or log it as &quot;something else&quot;.</T> : null}
        </Card>
      </Section>
    </Screen>
  );
}
