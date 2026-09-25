/**
 * Plant catalogue search. Understands queries like "fruit trees", "suitable
 * for pots", "subtropical vegetables", "things I can plant now".
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { parseQuery, searchPlants, type PlantFilters } from '../../src/domain/catalogue';
import { catalogue } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { Badge, Button, Card, Chip, EmptyState, ListRow, Row, Screen, T } from '../../src/ui/components/primitives';
import { radius, space, TOUCH, usePalette } from '../../src/ui/theme/theme';

type Toggle = 'plantableNow' | 'containers' | 'shadeTolerant' | 'trellis' | 'fastGrowing' | 'pollinator' | 'lowMaintenance' | 'perennial';
const TOGGLES: { key: Toggle; label: string }[] = [
  { key: 'plantableNow', label: 'Plant now' },
  { key: 'containers', label: 'Pots' },
  { key: 'shadeTolerant', label: 'Some shade' },
  { key: 'trellis', label: 'Trellis' },
  { key: 'fastGrowing', label: 'Fast growing' },
  { key: 'pollinator', label: 'Pollinators' },
  { key: 'lowMaintenance', label: 'Low maintenance' },
  { key: 'perennial', label: 'Perennial' },
];
const EXAMPLES = ['fruit trees', 'suitable for pots', 'things I can plant now', 'shade tolerant', 'plants for a trellis', 'pollinator plants', 'fast-growing vegetables'];

export default function Plants() {
  const { zone, today, data, state } = useGardenView();
  const p = usePalette();
  const [q, setQ] = useState('');
  const [toggles, setToggles] = useState<Partial<Record<Toggle, boolean>>>({});
  const wished = new Set(data.wishlist.map((w) => w.plantId));

  const results = useMemo(() => {
    const parsed: PlantFilters = parseQuery(q);
    for (const t of TOGGLES) if (toggles[t.key]) parsed[t.key] = true;
    return searchPlants(catalogue, parsed, { zone, today });
    // state.catalogueRev: results change when you add a plant or the plant list updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, toggles, zone, today, state.catalogueRev]);

  return (
    <Screen>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Try: tomatoes, herbs for pots, subtropical vegetables"
        placeholderTextColor={p.textMuted}
        accessibilityLabel="Search plants"
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, color: p.text, backgroundColor: p.surface }}
        returnKeyType="search"
      />
      <Row wrap>
        {TOGGLES.map((t) => (
          <Chip key={t.key} label={t.label} selected={!!toggles[t.key]} onPress={() => setToggles((s) => ({ ...s, [t.key]: !s[t.key] }))} />
        ))}
      </Row>
      {!q ? (
        <Row wrap gap={6}>
          <T variant="tiny" muted>Examples:</T>
          {EXAMPLES.map((e) => (
            <Chip key={e} label={e} onPress={() => setQ(e)} />
          ))}
        </Row>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="tiny" muted>{`${results.length} plant${results.length === 1 ? '' : 's'}`}</T>
        <Button compact variant="ghost" icon="add" label="Add a plant that isn't listed" onPress={() => router.push({ pathname: '/plant/custom', params: { name: q.trim() } })} />
      </Row>
      {results.length === 0 ? (
        <EmptyState icon="search-outline" title="No plants match" body="Try fewer words or clear some filters. If a plant is missing, add it yourself with “Add a plant that isn't listed”." />
      ) : (
        <Card>
          {results.map(({ plant, matched }) => (
            <View key={plant.id}>
              <ListRow
                title={plant.commonName}
                subtitle={[plant.botanicalName, matched.join(' · ')].filter(Boolean).join(' — ')}
                icon={plant.categories.includes('fruit') ? 'nutrition-outline' : plant.categories.includes('flower') ? 'flower-outline' : plant.categories.includes('herb') ? 'sparkles-outline' : 'leaf-outline'}
                right={wished.has(plant.id) ? <Badge tone="earth" icon="heart" label="Wish" /> : undefined}
                onPress={() => router.push(`/plant/${plant.id}`)}
              />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
