import { router } from 'expo-router';
import React, { useState } from 'react';
import { formatDay } from '../src/domain/dates';
import { getPlant } from '../src/state/gardenStore';
import { useGardenView } from '../src/state/hooks';
import { DateField } from '../src/ui/components/garden';
import { Button, Card, Chip, EmptyState, Field, IconButton, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { primaryAreaId } from '../src/domain/plantingAreas';

export default function Journal() {
  const { data, store, today } = useGardenView();
  const [text, setText] = useState('');
  const [date, setDate] = useState(today);
  const [plantingId, setPlantingId] = useState<string | undefined>();
  const active = data.plantings.filter((p) => !['finished', 'removed', 'failed'].includes(p.stage));

  return (
    <Screen>
      <T variant="title">Garden journal</T>
      <Section title="New note">
        <Field label="What happened?" value={text} onChangeText={setText} placeholder="e.g. first flowers appeared, aphids noticed, added compost" multiline />
        <DateField label="Date" value={date} onChange={setDate} />
        {active.length ? (
          <>
            <T variant="small" style={{ fontWeight: '600' }}>About a planting? (optional)</T>
            <Row wrap>
              <Chip label="Whole garden" selected={!plantingId} onPress={() => setPlantingId(undefined)} />
              {active.slice(0, 20).map((p) => (
                <Chip key={p.id} label={`${getPlant(p.plantId)?.commonName ?? p.plantId}${p.variety ? ` '${p.variety}'` : ''}`} selected={plantingId === p.id} onPress={() => setPlantingId(p.id)} />
              ))}
            </Row>
          </>
        ) : null}
        <Button
          icon="create-outline"
          label="Save note"
          disabled={!text.trim()}
          onPress={async () => {
            const pl = data.plantings.find((p) => p.id === plantingId);
            await store.addJournal(text, date, { plantingId, areaId: pl ? primaryAreaId(pl) : undefined });
            setText('');
          }}
        />
      </Section>
      <Section title="Notes">
        {data.journal.length === 0 ? <EmptyState icon="create-outline" title="No notes yet" body="Notes linked to a planting also appear in its timeline." /> : null}
        {data.journal.map((j) => {
          const pl = data.plantings.find((p) => p.id === j.plantingId);
          return (
            <Card key={j.id}>
              <Row style={{ justifyContent: 'space-between' }} align="flex-start">
                <T variant="small" muted>{`${formatDay(j.date, today)}${pl ? ` · ${getPlant(pl.plantId)?.commonName ?? ''}` : ''}`}</T>
                <IconButton icon="trash-outline" label="Delete note" onPress={() => void store.deleteJournal(j.id)} />
              </Row>
              <T>{j.text}</T>
              {pl ? <Button compact variant="ghost" label="Open planting" onPress={() => router.push(`/planting/${pl.id}`)} /> : null}
            </Card>
          );
        })}
      </Section>
    </Screen>
  );
}
