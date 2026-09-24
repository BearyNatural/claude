/**
 * Plant Now — "What can I plant now?" with explanations, grouped into
 * Great time / Can plant / Soon / Better to wait / Outside season.
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { CLIMATE_ZONES } from '../../src/domain/climate';
import type { PlantCategory } from '../../src/domain/plantTypes';
import { formatRange } from '../../src/domain/production';
import type { Recommendation, RecCategory } from '../../src/domain/recommend';
import { isSuccessionSuited } from '../../src/domain/succession';
import { useGardenView } from '../../src/state/hooks';
import { CATEGORY_STYLE, CategoryBadge, InfoTip, ReasonList } from '../../src/ui/components/garden';
import { Badge, Button, Card, Chip, Notice, Row, Screen, Section, T } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

const FILTERS: { id: 'all' | PlantCategory; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'vegetable', label: 'Vegetables' },
  { id: 'herb', label: 'Herbs' },
  { id: 'fruit', label: 'Fruit' },
  { id: 'flower', label: 'Flowers' },
  { id: 'native', label: 'Native' },
];

function RecCard({ r, onWish }: { r: Recommendation; onWish: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const inPlay = r.category === 'great' || r.category === 'can' || r.category === 'soon';
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }} align="flex-start">
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="h3" accessibilityRole="header">{r.plant.commonName}</T>
          <Row wrap gap={6}>
            <CategoryBadge category={r.category} />
            {r.onWishlist ? <Badge tone="earth" icon="heart" label="Wish list" /> : null}
            {r.activePlantings ? <Badge tone="neutral" icon="leaf" label="Growing" /> : null}
          </Row>
        </View>
      </Row>
      <T variant="small" style={{ fontWeight: '600' }}>{r.headline}</T>
      <ReasonList reasons={r.reasons} limit={expanded ? undefined : 2} />
      {r.reasons.length > 2 ? <Button compact variant="ghost" label={expanded ? 'Fewer details' : `Why? (${r.reasons.length - 2} more)`} onPress={() => setExpanded((e) => !e)} /> : null}
      {r.quantity && inPlay ? (
        <Row gap={4} align="flex-start">
          <T variant="small" style={{ flex: 1 }}>
            {`Suggested ${r.successionDue || isSuccessionSuited(r.plant) ? 'batch' : 'amount'}: ${formatRange(r.quantity.range, r.quantity.unit)} (planning estimate).`}
          </T>
        </Row>
      ) : null}
      <Row wrap gap={space.sm}>
        {inPlay || r.category === 'wait' ? <Button compact icon="add" label="Add to garden" onPress={() => router.push({ pathname: '/planting/new', params: { plantId: r.plant.id, method: r.suggestedMethod } })} /> : null}
        {isSuccessionSuited(r.plant) && (r.category === 'great' || r.category === 'can') ? (
          <Button compact variant="secondary" icon="repeat" label="Plan succession" onPress={() => router.push({ pathname: '/succession/new', params: { plantId: r.plant.id } })} />
        ) : null}
        <Button compact variant="ghost" icon={r.onWishlist ? 'heart' : 'heart-outline'} label={r.onWishlist ? 'On wish list' : 'Wish list'} onPress={onWish} />
        <Button compact variant="ghost" icon="information-circle-outline" label="Details" onPress={() => router.push(`/plant/${r.plant.id}`)} />
      </Row>
    </Card>
  );
}

export default function PlantNow() {
  const { plantNow, zone, store, weather } = useGardenView();
  const [filter, setFilter] = useState<'all' | PlantCategory>('all');
  const [open, setOpen] = useState<Record<RecCategory, boolean>>({ great: true, can: true, soon: true, wait: true, outside: false, unknown: false });

  const groups = useMemo(
    () =>
      plantNow.groups
        .map((g) => ({ ...g, items: filter === 'all' ? g.items : g.items.filter((r) => r.plant.categories.includes(filter)) }))
        .filter((g) => g.items.length),
    [plantNow, filter],
  );

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T variant="title">What can I plant now?</T>
        <T variant="small" muted>
          {zone ? `For ${CLIMATE_ZONES[zone].name.toLowerCase()} areas, using your garden, goals and ${weather.seasonalOnly ? 'seasonal timing' : 'the local forecast'}.` : 'Set your location to see local timing.'}
        </T>
      </View>
      {weather.seasonalOnly ? <Notice tone="neutral" icon="cloud-offline-outline">Live weather is unavailable, so these suggestions use seasonal timing only.</Notice> : null}
      {weather.freshness === 'stale' ? <Notice tone="caution" icon="time-outline">{weather.caveat}</Notice> : null}
      <Row wrap>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </Row>
      <Row gap={4}>
        <T variant="tiny" muted>Seasonal windows come from Australian planting guides; dates are typical, not guaranteed.</T>
        <InfoTip termId="succession-planting" />
      </Row>
      {groups.map((g) => (
        <Section
          key={g.category}
          title={`${g.label} (${g.items.length})`}
          action={<Button compact variant="ghost" icon={open[g.category] ? 'chevron-up' : 'chevron-down'} label={open[g.category] ? 'Hide' : 'Show'} onPress={() => setOpen((o) => ({ ...o, [g.category]: !o[g.category] }))} />}
        >
          {open[g.category] ? (
            g.items.map((r) => <RecCard key={r.plant.id} r={r} onWish={() => void store.toggleWish(r.plant.id)} />)
          ) : (
            <T variant="small" muted>{g.items.map((r) => r.plant.commonName).join(', ')}</T>
          )}
          {g.category === 'wait' && open.wait ? <T variant="tiny" muted>{`"${CATEGORY_STYLE.wait.short}" is advice, not a rule — you can still plant anything.`}</T> : null}
        </Section>
      ))}
    </Screen>
  );
}
