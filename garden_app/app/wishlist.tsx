import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { describeOffset, formatDay } from '../src/domain/dates';
import { areaUsage, footprintPerPlantM2, sunCheck } from '../src/domain/space';
import { primaryWindow, windowPosition } from '../src/domain/windows';
import { getPlant } from '../src/state/gardenStore';
import { useGardenView } from '../src/state/hooks';
import { PlantPicker } from '../src/ui/components/garden';
import { Badge, Button, Card, EmptyState, Row, Screen, T } from '../src/ui/components/primitives';

/** Wish-list messages combine the season, garden space and sun. */
export default function WishList() {
  const { data, store, zone, today } = useGardenView();
  const items = useMemo(
    () =>
      data.wishlist.map((w) => {
        const plant = getPlant(w.plantId);
        const msgs: { tone: 'good' | 'info' | 'caution' | 'neutral'; text: string }[] = [];
        if (!plant) return { w, plant, msgs };
        const win = primaryWindow(plant, zone);
        if (!win) msgs.push({ tone: 'neutral', text: 'No sourced planting window for your zone yet.' });
        else {
          const pos = windowPosition(win.months, today);
          if (pos.inWindow) msgs.push({ tone: 'good', text: `You can ${win.kind} ${plant.commonName.toLowerCase()} now${pos.closesOn && !pos.allYear ? ` (until the end of ${formatDay(pos.closesOn).split(' ')[1]})` : ''}.` });
          else if (pos.opensOn) msgs.push({ tone: 'info', text: `${plant.commonName} is on your wish list. Your recommended planting period starts ${describeOffset(pos.daysUntilOpen!)}.` });
        }
        const areas = data.areas.filter((a) => !a.archived);
        const fp = footprintPerPlantM2(plant);
        if (areas.length && fp) {
          const roomy = areas.filter((a) => {
            const free = areaUsage(a, data.plantings, getPlant).freeM2;
            return free === null || free >= fp;
          });
          const sunny = roomy.filter((a) => !sunCheck(a, plant));
          if (roomy.length === 0) msgs.push({ tone: 'caution', text: 'Your garden areas look full at the moment.' });
          else if (sunny.length === 0 && plant.site.sun === 'full-sun') msgs.push({ tone: 'caution', text: `You want to grow ${plant.commonName.toLowerCase()}, but your areas with space have limited sun.` });
        }
        return { w, plant, msgs };
      }),
    [data, zone, today],
  );

  return (
    <Screen>
      <T variant="title">Wish list</T>
      <T variant="small" muted>Plants you&apos;d like to grow. We&apos;ll let you know when their season comes around.</T>
      <PlantPicker onChange={(id) => { if (!data.wishlist.some((w) => w.plantId === id)) void store.toggleWish(id); }} zone={zone} today={today} />
      {items.length === 0 ? <EmptyState icon="heart-outline" title="Your wish list is empty" body="Add plants you'd like to grow — from here or any plant page." /> : null}
      {items.map(({ w, plant, msgs }) =>
        plant ? (
          <Card key={w.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="h3">{plant.commonName}</T>
              <Button compact variant="ghost" icon="close" label="Remove" onPress={() => void store.toggleWish(plant.id)} />
            </Row>
            {msgs.map((m, i) => (
              <Row key={i} gap={6} align="flex-start">
                <Badge tone={m.tone} label={m.tone === 'good' ? 'Now' : m.tone === 'info' ? 'Soon' : m.tone === 'caution' ? 'Check' : 'Note'} />
                <T variant="small" style={{ flex: 1 }}>{m.text}</T>
              </Row>
            ))}
            <Row gap={8} wrap>
              <Button compact icon="add" label="Plant it" onPress={() => router.push({ pathname: '/planting/new', params: { plantId: plant.id } })} />
              <Button compact variant="ghost" label="Details" onPress={() => router.push(`/plant/${plant.id}`)} />
            </Row>
          </Card>
        ) : null,
      )}
    </Screen>
  );
}
