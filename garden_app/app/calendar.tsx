import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { buildCalendar } from '../src/domain/calendar';
import { CLIMATE_ZONES } from '../src/domain/climate';
import { formatApproxRange, formatDay } from '../src/domain/dates';
import { getPlant } from '../src/state/gardenStore';
import { useGardenView } from '../src/state/hooks';
import { Badge, Card, EmptyState, ListRow, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { type as typeScale, usePalette } from '../src/ui/theme/theme';

const CELL = 34;

export default function Calendar() {
  const { data, today, zone, tasks } = useGardenView();
  const p = usePalette();
  const cal = useMemo(
    () =>
      buildCalendar({
        today,
        zone,
        plantings: data.plantings,
        journal: data.journal,
        wishlistPlantIds: data.wishlist.map((w) => w.plantId),
        successionPlans: data.successionPlans,
        tasks,
        getPlant,
      }),
    [today, zone, data, tasks],
  );

  const marks: { key: 'sow' | 'plant_' | 'flowering' | 'harvest'; letter: string; label: string; color: string; bg: string }[] = [
    { key: 'sow', letter: 'S', label: 'Sow', color: p.good, bg: p.goodSoft },
    { key: 'plant_', letter: 'P', label: 'Plant', color: p.primary, bg: p.primarySoft },
    { key: 'flowering', letter: 'F', label: 'Flowering (est.)', color: p.sky, bg: p.skySoft },
    { key: 'harvest', letter: 'H', label: 'Harvest', color: p.accent, bg: p.accentSoft },
  ];

  return (
    <Screen>
      <T variant="title">Seasonal calendar</T>
      <T variant="small" muted>{zone ? `${CLIMATE_ZONES[zone].name} planting windows for the plants you grow or want, with estimated flowering and harvest from your plantings.` : 'Set your location to see planting windows.'}</T>
      <Row wrap gap={6}>
        {marks.map((m) => (
          <Badge key={m.key} label={`${m.letter} = ${m.label}`} />
        ))}
      </Row>
      {cal.rows.length === 0 ? (
        <EmptyState icon="calendar-outline" title="Nothing to show yet" body="Add plantings or wish-list plants to build your calendar." />
      ) : (
        <Card style={{ padding: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 110 }} />
                {cal.months.map((m) => (
                  <Text key={m.key} style={[typeScale.tiny, { width: CELL, textAlign: 'center', color: p.textMuted }]}>{m.label.split(' ')[0]}</Text>
                ))}
              </View>
              {cal.rows.map((row) => (
                <View key={row.plant.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: p.border }}>
                  <Text numberOfLines={2} style={[typeScale.small, { width: 110, color: p.text, fontWeight: '600' }]} onPress={() => router.push(`/plant/${row.plant.id}`)} accessibilityRole="link">
                    {row.plant.commonName}
                    {row.reason === 'wishlist' ? ' ♡' : ''}
                  </Text>
                  {cal.months.map((m, i) => {
                    const on = marks.filter((mk) => row[mk.key][i]);
                    return (
                      <View key={m.key} accessible accessibilityLabel={`${row.plant.commonName}, ${m.label}: ${on.map((o) => o.label).join(', ') || 'nothing'}`} style={{ width: CELL, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}>
                        {on.map((o) => (
                          <Text key={o.key} style={{ fontSize: 10, fontWeight: '700', color: o.color, backgroundColor: o.bg, paddingHorizontal: 2, borderRadius: 3 }}>{o.letter}</Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}
      <Section title="Coming up (next 2 months)">
        {cal.upcoming.length ? (
          <Card>
            {cal.upcoming.slice(0, 30).map((u, i) => (
              <ListRow
                key={`${u.date}-${i}`}
                icon={u.kind === 'succession' ? 'repeat-outline' : u.kind === 'planned' ? 'leaf-outline' : u.kind === 'task' ? 'checkbox-outline' : 'analytics-outline'}
                title={u.label}
                subtitle={`${u.endDate ? formatApproxRange(u.date, u.endDate) : formatDay(u.date, today)}${u.estimated ? ' · estimate' : ''}`}
                onPress={u.plantingId ? () => router.push(`/planting/${u.plantingId}`) : u.planId ? () => router.push(`/succession/${u.planId}`) : undefined}
              />
            ))}
          </Card>
        ) : (
          <T variant="small" muted>Nothing scheduled.</T>
        )}
      </Section>
    </Screen>
  );
}
