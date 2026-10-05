/**
 * A logged pest or problem: what to do (natural steps first), when to check
 * again, photos, and the option to remove it.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { PLANT_PROBLEMS } from '../../src/data/pests';
import { formatDay } from '../../src/domain/dates';
import { checkAgainDate } from '../../src/domain/pests';
import { getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { PhotoStrip } from '../../src/ui/components/photos';
import { RemedyList, SourceLinks } from '../../src/ui/components/pests';
import { Button, Card, EmptyState, Notice, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

export default function PestReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, today, store } = useGardenView();
  const [confirm, setConfirm] = useState(false);
  const r = data.pestReports.find((x) => x.id === id);
  if (!r) return <Screen><EmptyState title="Not found" body="This report may have been removed." /></Screen>;
  const problem = PLANT_PROBLEMS.find((p) => p.id === r.problemId);
  const planting = r.plantingId ? data.plantings.find((x) => x.id === r.plantingId) : undefined;
  const plant = getPlant(planting?.plantId ?? r.plantId ?? '');
  const title = problem?.name ?? r.otherName ?? 'Problem';
  const again = checkAgainDate(problem, r.seenOn);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Card>
        <T variant="small">{`${plant ? `On ${planting ? 'your ' : ''}${plant.commonName.toLowerCase()}${planting?.variety ? ` (${planting.variety})` : ''}, ` : ''}seen ${formatDay(r.seenOn, today)}${r.amount ? ` — ${r.amount === 'lots' ? 'lots' : r.amount === 'some' ? 'some' : 'just a few'}` : ''}.`}</T>
        {r.notes ? <T variant="small" muted>{r.notes}</T> : null}
        <T variant="small" style={{ fontWeight: '600' }}>{`Check again ${again <= today ? 'now' : formatDay(again, today)} — it's on This Week.`}</T>
        <Row wrap gap={space.sm}>
          {planting ? <Button compact variant="ghost" icon="leaf-outline" label="Open planting" onPress={() => router.push(`/planting/${planting.id}`)} /> : null}
          {problem ? <Button compact variant="ghost" icon="book-outline" label="Guide page" onPress={() => router.push(`/problem/${problem.id}`)} /> : null}
        </Row>
      </Card>

      {problem ? (
        <>
          <Section title="What you'll see">
            <Card>
              <T variant="small">{problem.signs}</T>
            </Card>
          </Section>
          <Section title="What to do" subtitle="Start at the top — natural steps first">
            <RemedyList problem={problem} />
          </Section>
        </>
      ) : (
        <Notice tone="info" title="Not in the guide yet">
          Look closely (under leaves too), remove affected parts, and try the gentlest fixes first: hosing off, hand-picking, or a soap spray. A local nursery can help identify it from a photo.
        </Notice>
      )}

      <Section title="Photos">
        <PhotoStrip
          photos={r.photos ?? []}
          store={store}
          today={today}
          empty="Add a photo to compare later, or to show at a nursery."
          onAdd={(imgs) => store.addPestPhotos(r.id, imgs)}
          onRemove={(pid) => store.removePestPhoto(r.id, pid)}
        />
      </Section>

      {problem ? (
        <Card>
          <SourceLinks ids={[...problem.sourceIds, ...problem.remedies.flatMap((x) => x.sourceIds)]} />
        </Card>
      ) : null}

      {confirm ? (
        <Notice
          tone="caution"
          title="Remove this report?"
          action={
            <Row gap={space.sm}>
              <Button compact variant="danger" label="Remove" onPress={async () => { await store.deletePestReport(r.id); router.back(); }} />
              <Button compact variant="secondary" label="Keep" onPress={() => setConfirm(false)} />
            </Row>
          }
        >
          Its photos are deleted too.
        </Notice>
      ) : (
        <Button variant="ghost" icon="trash-outline" label="Remove report" onPress={() => setConfirm(true)} />
      )}
    </Screen>
  );
}
