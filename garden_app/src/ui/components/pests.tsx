/**
 * Showing pest remedies (natural first, chemical last), fertiliser advice and
 * where each piece of advice comes from.
 */
import React from 'react';
import { Linking, View } from 'react-native';
import type { FertiliserProfile } from '../../data/fertilisers';
import { SOURCES } from '../../data/sources';
import { REMEDY_STEP_LABELS, remedyPlan, type PlantProblem, type RemedyStep } from '../../domain/pests';
import { space } from '../theme/theme';
import { Badge, Button, Card, Notice, Row, T, type IconName, type Tone } from './primitives';

const STEP_STYLE: Record<RemedyStep, { icon: IconName; tone: Tone }> = {
  prevent: { icon: 'shield-checkmark-outline', tone: 'good' },
  'by-hand': { icon: 'hand-left-outline', tone: 'good' },
  helpers: { icon: 'bug-outline', tone: 'good' },
  'home-spray': { icon: 'water-outline', tone: 'info' },
  'organic-spray': { icon: 'leaf-outline', tone: 'info' },
  chemical: { icon: 'warning-outline', tone: 'caution' },
};

/** The remedies for a problem, grouped by step, in order of preference. */
export function RemedyList({ problem }: { problem: PlantProblem }) {
  const plan = remedyPlan(problem);
  return (
    <View style={{ gap: space.md }}>
      {plan.map((r, i) => (
        <Card key={i}>
          <Badge tone={STEP_STYLE[r.step].tone} icon={STEP_STYLE[r.step].icon} label={`${i + 1}. ${REMEDY_STEP_LABELS[r.step]}`} />
          <T variant="small">{r.text}</T>
          {r.repeatDays ? <T variant="tiny" muted>{`Repeat about every ${r.repeatDays} days while it's still there.`}</T> : null}
          {r.caution ? <Notice tone="caution">{r.caution}</Notice> : null}
        </Card>
      ))}
      {!plan.some((r) => r.step === 'chemical') ? (
        <T variant="tiny" muted>No chemical is suggested for this one — the steps above are what the sources recommend.</T>
      ) : (
        <T variant="tiny" muted>Only reach for the last step if the natural steps haven&apos;t worked.</T>
      )}
    </View>
  );
}

/** What to feed a plant. */
export function FertiliserCard({ profile }: { profile: FertiliserProfile }) {
  return (
    <Card>
      <T variant="h3">{profile.name}</T>
      <T variant="small">{profile.use}</T>
      <T variant="small" muted>{profile.balance}</T>
      {profile.when ? <T variant="small">{`When: ${profile.when}`}</T> : null}
      <T variant="small" style={{ fontWeight: '600' }}>Natural and organic options</T>
      {profile.organic.map((o) => (
        <Row key={o} gap={6} align="flex-start">
          <T variant="small">•</T>
          <T variant="small" style={{ flex: 1 }}>{o}</T>
        </Row>
      ))}
      {profile.avoid ? <Notice tone="caution" title="Avoid">{profile.avoid}</Notice> : null}
      <SourceLinks ids={profile.sourceIds} />
    </Card>
  );
}

/** Short source list with links. */
export function SourceLinks({ ids }: { ids: string[] }) {
  const unique = [...new Set(ids)].map((id) => SOURCES[id]).filter(Boolean);
  if (!unique.length) return null;
  return (
    <View style={{ gap: 2 }}>
      <T variant="tiny" muted>Sources</T>
      {unique.map((s) => (
        <Row key={s.id} gap={4} wrap>
          <T variant="tiny" style={{ flex: 1 }}>{`${s.title} — ${s.publisher}`}</T>
          {s.url ? <Button compact variant="ghost" icon="open-outline" label="Open" onPress={() => void Linking.openURL(s.url!)} /> : null}
        </Row>
      ))}
    </View>
  );
}

export const PROBLEM_KIND_LABEL: Record<PlantProblem['kind'], string> = {
  insect: 'Insect',
  mite: 'Mite',
  snail: 'Snails & slugs',
  disease: 'Disease',
  disorder: 'Growing problem',
};
