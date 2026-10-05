/**
 * A page of the pest & problem guide: signs, plants it affects, and remedies
 * in order of preference.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { PLANT_PROBLEMS } from '../../src/data/pests';
import { problemAffects } from '../../src/domain/pests';
import { catalogue } from '../../src/state/gardenStore';
import { PROBLEM_KIND_LABEL, RemedyList, SourceLinks } from '../../src/ui/components/pests';
import { Badge, Button, Card, EmptyState, Screen, Section, T } from '../../src/ui/components/primitives';

export default function ProblemGuide() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const problem = PLANT_PROBLEMS.find((p) => p.id === id);
  if (!problem) return <Screen><EmptyState title="Not in the guide" /></Screen>;
  const plants = catalogue.all.filter((p) => problemAffects(problem, p)).map((p) => p.commonName);
  const sources = [...problem.sourceIds, ...problem.remedies.flatMap((r) => r.sourceIds)];
  return (
    <Screen>
      <Stack.Screen options={{ title: problem.name }} />
      <Badge icon={problem.kind === 'disease' || problem.kind === 'disorder' ? 'medkit-outline' : 'bug-outline'} label={PROBLEM_KIND_LABEL[problem.kind]} />
      <Section title="What you'll see">
        <Card>
          <T variant="small">{problem.signs}</T>
          {plants.length ? <T variant="tiny" muted>{`Common on: ${plants.join(', ')}.`}</T> : null}
        </Card>
      </Section>
      <Section title="What to do" subtitle="Start at the top — natural steps first">
        <RemedyList problem={problem} />
      </Section>
      <Button icon="add" label="Log this on a plant" onPress={() => router.push({ pathname: '/pests/new', params: { problemId: problem.id } })} />
      <Section title="Where this comes from">
        <Card>
          <SourceLinks ids={sources} />
          <T variant="tiny" muted>Check product labels and local advice before spraying — not every product is registered for every crop in every state.</T>
        </Card>
      </Section>
    </Screen>
  );
}
