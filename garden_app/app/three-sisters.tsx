import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SOURCES } from '../src/data/sources';
import { THREE_SISTERS } from '../src/data/systems';
import { formatApproxRange, formatDay } from '../src/domain/dates';
import { areaUsage } from '../src/domain/space';
import { planSystem } from '../src/domain/systems';
import { getPlant } from '../src/state/gardenStore';
import { useGardenView } from '../src/state/hooks';
import { DateField } from '../src/ui/components/garden';
import { Badge, Button, Card, Chip, Notice, Row, Screen, Section, Stepper, T } from '../src/ui/components/primitives';
import { space } from '../src/ui/theme/theme';

export default function ThreeSisters() {
  const { today, zone, data, store } = useGardenView();
  const [start, setStart] = useState(today);
  const [areaId, setAreaId] = useState<string | undefined>();
  const [mounds, setMounds] = useState(3);
  const [sown, setSown] = useState(false);
  const [saving, setSaving] = useState(false);
  const plan = useMemo(() => planSystem(THREE_SISTERS, start, zone, getPlant), [start, zone]);
  const area = data.areas.find((a) => a.id === areaId);
  const free = area ? areaUsage(area, data.plantings, getPlant).freeM2 : null;
  const tooSmall = free !== null && free < mounds * 1.0;

  return (
    <Screen>
      <T variant="title">{THREE_SISTERS.name}</T>
      <T>{THREE_SISTERS.summary}</T>
      {THREE_SISTERS.culturalNote ? <T variant="small" muted>{THREE_SISTERS.culturalNote}</T> : null}

      <Section title="How the sisters help each other">
        {THREE_SISTERS.members.map((m) => (
          <Card key={m.role}>
            <T variant="h3">{m.roleLabel}</T>
            {m.functions.map((f, i) => (
              <T key={i} variant="small">{`• ${f}`}</T>
            ))}
            {m.after ? <Badge tone="info" icon="time-outline" label={`Sow ${m.after.trigger ?? `${m.after.days[0]}–${m.after.days[1]} days later`}`} /> : <Badge tone="good" icon="flag-outline" label="Goes in first" />}
          </Card>
        ))}
      </Section>

      <Section title="Layout">
        <Card>
          {THREE_SISTERS.layout.map((l, i) => (
            <T key={i} variant="small">{`${i + 1}. ${l}`}</T>
          ))}
        </Card>
        {THREE_SISTERS.cautions.map((c, i) => (
          <Notice key={i} tone="caution">{c}</Notice>
        ))}
      </Section>

      <Section title="Plan yours">
        <DateField label="Corn sowing date" value={start} onChange={setStart} />
        <Row wrap>
          <Chip label="Corn already sown" selected={sown} onPress={() => setSown(true)} />
          <Chip label="Planning ahead" selected={!sown} onPress={() => setSown(false)} />
        </Row>
        <Stepper label="Number of mounds" value={mounds} onChange={setMounds} min={1} max={50} />
        <T variant="small" style={{ fontWeight: '600' }}>Where?</T>
        <Row wrap>
          <Chip label="Not sure yet" selected={!areaId} onPress={() => setAreaId(undefined)} />
          {data.areas.filter((a) => !a.archived).map((a) => (
            <Chip key={a.id} label={a.name} selected={areaId === a.id} onPress={() => setAreaId(a.id)} />
          ))}
        </Row>
        {tooSmall ? <Notice tone="caution">{`${area!.name} has roughly ${free!.toFixed(1)} m² free; ${mounds} mounds usually need about ${mounds} m². Consider fewer mounds.`}</Notice> : null}
        <Card>
          {plan.steps.map((s) => (
            <View key={s.role} style={{ gap: 2, paddingVertical: 4 }}>
              <Row gap={6} wrap>
                <T variant="small" style={{ fontWeight: '600' }}>{s.roleLabel}</T>
                <Badge tone={s.inWindow === false ? 'caution' : 'good'} icon={s.inWindow === false ? 'alert-circle-outline' : 'checkmark'} label={s.inWindow === false ? 'Outside window' : s.inWindow ? 'In season' : 'No data'} />
              </Row>
              <T variant="small">{s.role === 'support' ? formatDay(s.suggested, today) : `${formatApproxRange(s.earliest, s.latest)} — ${s.trigger}`}</T>
              {s.warnings.map((w, i) => (
                <T key={i} variant="tiny" muted>{w}</T>
              ))}
            </View>
          ))}
        </Card>
        {!plan.ok ? <Notice tone="caution">Some steps fall outside their usual window for your area. You can still go ahead — or try an earlier start date.</Notice> : null}
        <Button
          icon="leaf"
          label="Add to my garden"
          loading={saving}
          onPress={async () => {
            setSaving(true);
            await store.startThreeSisters({ startDate: start, areaId, mounds, cornAlreadySown: sown });
            router.replace('/garden');
          }}
        />
        <T variant="tiny" muted>{`Source: ${THREE_SISTERS.sourceIds.map((i) => SOURCES[i]?.publisher ?? i).join('; ')}. Timings are approximate — watch the corn, not the calendar.`}</T>
      </Section>
      <View style={{ height: space.lg }} />
    </Screen>
  );
}
