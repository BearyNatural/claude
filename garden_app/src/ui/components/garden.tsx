/**
 * Garden-specific presentational components. They render domain results;
 * they don't compute gardening rules.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GLOSSARY } from '../../data/glossary';
import { searchByText } from '../../domain/catalogue';
import { CLIMATE_ZONES } from '../../domain/climate';
import { addDays, formatApproxRange, formatDay, isISODate, MONTH_SHORT, monthOf } from '../../domain/dates';
import type { PlantRecord } from '../../domain/plantTypes';
import type { Reason, RecCategory } from '../../domain/recommend';
import type { TimelineItem } from '../../domain/timeline';
import type { ClimateZoneId, GardenTask, ISODate, Month } from '../../domain/types';
import { describeAge, describeSoilTemperature, type WeatherAssessment } from '../../domain/weather';
import { catalogue } from '../../state/gardenStore';
import { useGardenState } from '../../state/hooks';
import { radius, space, TOUCH, type, usePalette } from '../theme/theme';
import { Badge, Button, Card, Chip, IconButton, Notice, Row, T, toneColors, type IconName, type Tone } from './primitives';

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export function BrandHeader({ compact }: { compact?: boolean }) {
  const p = usePalette();
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Sow by Season, by BearyNatural">
      <T variant={compact ? 'h2' : 'title'} color={p.primary}>Sow by Season</T>
      <T variant="tiny" muted style={{ letterSpacing: 0.5 }}>by BearyNatural</T>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recommendation categories
// ---------------------------------------------------------------------------

export const CATEGORY_STYLE: Record<RecCategory, { tone: Tone; icon: IconName; short: string }> = {
  great: { tone: 'good', icon: 'checkmark-circle', short: 'Great time' },
  can: { tone: 'good', icon: 'checkmark', short: 'Can plant' },
  soon: { tone: 'info', icon: 'time-outline', short: 'Soon' },
  wait: { tone: 'caution', icon: 'hourglass-outline', short: 'Better to wait' },
  outside: { tone: 'neutral', icon: 'calendar-clear-outline', short: 'Out of season' },
  unknown: { tone: 'neutral', icon: 'help-circle-outline', short: 'No data yet' },
};

export function CategoryBadge({ category }: { category: RecCategory }) {
  const s = CATEGORY_STYLE[category];
  return <Badge tone={s.tone} icon={s.icon} label={s.short} />;
}

const REASON_ICON: Record<Reason['kind'], IconName> = {
  season: 'calendar-outline',
  climate: 'earth-outline',
  frost: 'snow-outline',
  heat: 'sunny-outline',
  rain: 'rainy-outline',
  soil: 'thermometer-outline',
  garden: 'leaf-outline',
  space: 'resize-outline',
  sun: 'partly-sunny-outline',
  goal: 'heart-outline',
  time: 'time-outline',
  data: 'information-circle-outline',
};

export function ReasonList({ reasons, limit }: { reasons: Reason[]; limit?: number }) {
  const p = usePalette();
  const shown = limit ? reasons.slice(0, limit) : reasons;
  return (
    <View style={{ gap: 6 }}>
      {shown.map((r, i) => {
        const color = r.tone === 'caution' ? p.caution : r.tone === 'positive' ? p.good : p.textMuted;
        return (
          <Row key={i} gap={8} align="flex-start">
            <Ionicons name={REASON_ICON[r.kind]} size={16} color={color} style={{ marginTop: 3 }} accessibilityElementsHidden importantForAccessibility="no" />
            <T variant="small" style={{ flex: 1 }}>{r.text}</T>
          </Row>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Month strip — seasonal windows at a glance
// ---------------------------------------------------------------------------

export function MonthStrip({ label, months, today, tone = 'good' }: { label: string; months: readonly number[]; today?: ISODate; tone?: Tone }) {
  const p = usePalette();
  const c = toneColors(p, tone);
  const set = new Set(months);
  const current = today ? monthOf(today) : undefined;
  const desc = months.length === 0 ? 'not recorded' : months.length === 12 ? 'all year' : MONTH_SHORT.filter((_, i) => set.has(i + 1)).join(', ');
  return (
    <View accessible accessibilityLabel={`${label}: ${desc}`} style={{ gap: 4 }}>
      <T variant="tiny" muted>{label}</T>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {MONTH_SHORT.map((m, i) => {
          const on = set.has(i + 1);
          const isNow = current === i + 1;
          return (
            <View
              key={m}
              style={[
                styles.monthCell,
                { backgroundColor: on ? c.bg : p.surfaceAlt, borderColor: isNow ? p.text : 'transparent' },
              ]}
            >
              <Text style={[type.tiny, { color: on ? c.fg : p.textMuted, fontWeight: on ? '700' : '400', fontSize: 10 }]}>{m[0]}</Text>
              {on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.fg, marginTop: 2 }} /> : <View style={{ height: 8 }} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export function WeatherCard({ w, loading, error, onRefresh, zone, needsLocation, onSetLocation }: { w: WeatherAssessment; loading?: boolean; error?: string; onRefresh?: () => void; zone: ClimateZoneId | null; needsLocation?: boolean; onSetLocation?: () => void }) {
  const p = usePalette();
  if (w.freshness === 'unavailable' && needsLocation) {
    return (
      <Notice tone="neutral" icon="location-outline" title="Live weather needs your area" action={onSetLocation ? <Button compact variant="ghost" icon="create-outline" label="Add suburb or postcode" onPress={onSetLocation} /> : undefined}>
        {`Your garden location doesn't include a suburb or postcode, so there's nowhere to get a forecast for. Advice is based on seasonal information${zone ? ` for ${CLIMATE_ZONES[zone].name.toLowerCase()} areas` : ''} until you add one.`}
      </Notice>
    );
  }
  if (w.freshness === 'unavailable') {
    return (
      <Notice tone="neutral" icon="cloud-offline-outline" title="Live weather unavailable" action={onRefresh ? <Button compact variant="ghost" icon="refresh" label={loading ? 'Checking…' : 'Try again'} onPress={onRefresh} loading={loading} /> : undefined}>
        {`${error ? `${error} ` : ''}Advice is based on seasonal information${zone ? ` for ${CLIMATE_ZONES[zone].name.toLowerCase()} areas` : ''}.`}
      </Notice>
    );
  }
  const today = w.upcoming[0];
  const stale = w.freshness === 'stale';
  return (
    <Card accessibilityLabel="Weather summary">
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <Ionicons name="partly-sunny-outline" size={22} color={p.sky} />
          <T variant="h3">This week&apos;s weather</T>
        </Row>
        <Badge tone={stale ? 'caution' : 'info'} icon={stale ? 'time-outline' : 'checkmark'} label={stale ? `Updated ${describeAge(w.ageHours)}` : 'Up to date'} />
      </Row>
      {today ? (
        <T variant="small">
          {`Today ${today.minC !== undefined ? `${Math.round(today.minC)}°` : '–'} to ${today.maxC !== undefined ? `${Math.round(today.maxC)}°C` : '–'}${today.precipitationMm ? `, about ${Math.round(today.precipitationMm)} mm rain` : ''}. Week range ${w.minNext7C !== undefined ? Math.round(w.minNext7C) : '–'}–${w.maxNext7C !== undefined ? Math.round(w.maxNext7C) : '–'}°C.`}
        </T>
      ) : null}
      <Row wrap gap={6}>
        {w.frostDays.length ? <Badge tone="info" icon="snow-outline" label={`Frost risk ${formatDay(w.frostDays[0])}`} /> : null}
        {w.heatDays.length ? <Badge tone="caution" icon="sunny" label={`Very hot ${formatDay(w.heatDays[0])}`} /> : null}
        {w.heavyRainDays.length ? <Badge tone="info" icon="rainy" label={`Heavy rain ${formatDay(w.heavyRainDays[0])}`} /> : null}
        {!w.frostDays.length && !w.heatDays.length && !w.heavyRainDays.length ? <Badge tone="good" icon="leaf-outline" label="No weather extremes forecast" /> : null}
      </Row>
      <Row gap={6} align="flex-start">
        <Ionicons name="thermometer-outline" size={16} color={p.textMuted} style={{ marginTop: 2 }} />
        <T variant="tiny" muted style={{ flex: 1 }}>{describeSoilTemperature(w)}</T>
        <InfoTip termId="modelled-soil-temperature" />
      </Row>
      {stale ? <T variant="tiny" color={p.caution}>{w.caveat}</T> : null}
      {onRefresh ? <Button compact variant="ghost" icon="refresh" label={loading ? 'Updating…' : 'Update weather'} onPress={onRefresh} loading={loading} /> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Glossary tooltip
// ---------------------------------------------------------------------------

export function InfoTip({ termId, label }: { termId: string; label?: string }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const term = GLOSSARY.find((g) => g.id === termId);
  if (!term) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`What does ${term.term} mean?`} hitSlop={10} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}>
        {label ? <T variant="small" color={p.primary} style={{ textDecorationLine: 'underline' }}>{label}</T> : null}
        <Ionicons name="help-circle-outline" size={18} color={p.primary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close explanation">
          <Pressable style={[styles.sheet, { backgroundColor: p.surface }]} accessibilityViewIsModal>
            <T variant="h2">{term.term}</T>
            <T>{term.short}</T>
            {term.more ? <T variant="small" muted>{term.more}</T> : null}
            <Button label="Got it" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Date input (no native dependency; validated text + quick adjust buttons)
// ---------------------------------------------------------------------------

export function DateField({ label, value, onChange, hint }: { label: string; value: ISODate; onChange: (d: ISODate) => void; hint?: string }) {
  const p = usePalette();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const apply = (t: string) => {
    setText(t);
    if (isISODate(t)) {
      setError(null);
      onChange(t);
    } else setError('Use the format YYYY-MM-DD, e.g. 2026-09-24');
  };
  const shift = (days: number) => apply(addDays(isISODate(text) ? text : value, days));
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small" style={{ fontWeight: '600' }}>{label}</T>
      <Row gap={space.sm}>
        <IconButton icon="chevron-back" label="One week earlier" onPress={() => shift(-7)} />
        <TextInput
          value={text}
          onChangeText={apply}
          accessibilityLabel={`${label}, ${isISODate(text) ? formatDay(text) : 'invalid date'}`}
          style={[styles.dateInput, { borderColor: error ? p.danger : p.border, color: p.text, backgroundColor: p.surface }]}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <IconButton icon="chevron-forward" label="One week later" onPress={() => shift(7)} />
      </Row>
      <T variant="tiny" color={error ? p.danger : p.textMuted}>{error ?? (isISODate(text) ? `${formatDay(text)}${hint ? ` · ${hint}` : ''}` : hint ?? '')}</T>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function TimelineList({ items, today }: { items: TimelineItem[]; today: ISODate }) {
  const p = usePalette();
  return (
    <View>
      {items.map((it, i) => {
        const estimated = it.status === 'estimated';
        const journal = it.status === 'journal';
        const past = (it.endDate ?? it.date) < today;
        const color = journal ? p.accent : estimated ? p.sky : p.primary;
        const when = it.endDate ? formatApproxRange(it.date, it.endDate) : formatDay(it.date, today);
        const statusWord = journal ? 'Journal note' : estimated ? 'Estimate' : 'Recorded';
        return (
          <View key={it.key} style={{ flexDirection: 'row', gap: space.md }} accessible accessibilityLabel={`${statusWord}: ${it.label}, ${when}${it.detail ? `. ${it.detail}` : ''}`}>
            <View style={{ alignItems: 'center', width: 20 }}>
              <View style={[styles.dot, { borderColor: color, backgroundColor: estimated ? 'transparent' : color, borderStyle: estimated ? 'dashed' : 'solid' }]} />
              {i < items.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: p.border }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md, opacity: estimated && past ? 0.7 : 1 }}>
              <Row gap={6} wrap>
                <T variant="small" style={{ fontWeight: '600' }}>{it.label}</T>
                <Badge tone={journal ? 'earth' : estimated ? 'info' : 'good'} icon={journal ? 'create-outline' : estimated ? 'analytics-outline' : 'checkmark'} label={statusWord} />
              </Row>
              <T variant="tiny" muted>{when}</T>
              {it.detail && !journal ? <T variant="tiny" muted>{it.detail}</T> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_ICON: Record<GardenTask['kind'], IconName> = {
  sow: 'leaf-outline',
  'succession-sow': 'repeat-outline',
  transplant: 'swap-vertical-outline',
  thin: 'cut-outline',
  water: 'water-outline',
  feed: 'nutrition-outline',
  mulch: 'layers-outline',
  stake: 'git-commit-outline',
  hill: 'trending-up-outline',
  prune: 'cut-outline',
  harvest: 'basket-outline',
  'frost-protect': 'snow-outline',
  'heat-protect': 'sunny-outline',
  'rain-check': 'rainy-outline',
  inspect: 'search-outline',
  'prepare-bed': 'construct-outline',
  'buy-seed': 'cart-outline',
  'system-step': 'git-network-outline',
};

const PRIORITY_BADGE: Record<GardenTask['priority'], { tone: Tone; label: string; icon: IconName }> = {
  important: { tone: 'caution', label: 'Important', icon: 'alert-circle-outline' },
  soon: { tone: 'info', label: 'Soon', icon: 'time-outline' },
  optional: { tone: 'neutral', label: 'Optional', icon: 'ellipse-outline' },
};

export function TaskCard({
  task,
  onDone,
  onSkip,
  onSnooze,
  onNextGardeningDay,
  onIrrelevant,
  onOpen,
  extra,
}: {
  task: GardenTask;
  onDone: () => void;
  onSkip: () => void;
  onSnooze: () => void;
  onNextGardeningDay?: () => void;
  onIrrelevant: () => void;
  onOpen?: () => void;
  extra?: React.ReactNode;
}) {
  const p = usePalette();
  const [more, setMore] = useState(false);
  const pb = PRIORITY_BADGE[task.priority];
  return (
    <Card>
      <Row gap={space.md} align="flex-start">
        <View style={[styles.taskIcon, { backgroundColor: p.primarySoft }]}>
          <Ionicons name={TASK_ICON[task.kind]} size={20} color={p.primary} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole={onOpen ? 'link' : undefined}>
            <T variant="h3">{task.title}</T>
          </Pressable>
          <Row gap={6} wrap>
            <Badge tone={pb.tone} icon={pb.icon} label={pb.label} />
            <Badge tone="neutral" icon="time-outline" label={`~${task.minutes} min`} />
          </Row>
          {task.detail ? <T variant="small">{task.detail}</T> : null}
          <T variant="tiny" muted>{task.why}</T>
          {extra}
        </View>
      </Row>
      <Row gap={space.sm} wrap>
        <Button compact icon="checkmark" label="Done" onPress={onDone} />
        {onNextGardeningDay ? <Button compact variant="secondary" icon="calendar-outline" label="Next gardening day" onPress={onNextGardeningDay} /> : null}
        <Button compact variant="ghost" label={more ? 'Less' : 'More'} icon={more ? 'chevron-up' : 'ellipsis-horizontal'} onPress={() => setMore((m) => !m)} />
      </Row>
      {more ? (
        <Row gap={space.sm} wrap>
          <Button compact variant="secondary" icon="alarm-outline" label="Snooze 2 days" onPress={onSnooze} />
          <Button compact variant="secondary" icon="play-skip-forward-outline" label="Skip" onPress={onSkip} />
          <Button compact variant="ghost" icon="close-circle-outline" label="Not relevant" onPress={onIrrelevant} />
        </Row>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Plant picker (search the catalogue)
// ---------------------------------------------------------------------------

export function PlantPicker({ value, onChange, zone, today }: { value?: string; onChange: (id: string) => void; zone: ClimateZoneId | null; today: ISODate }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { catalogueRev, data } = useGardenState();
  const results = useMemo(
    () => (q.trim() ? searchByText(catalogue, q, { zone, today }).map((r) => r.plant) : catalogue.all.slice().sort((a, b) => a.commonName.localeCompare(b.commonName))),
    // catalogueRev: the list changes when the gardener adds a plant or an update arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, zone, today, catalogueRev],
  );
  const current = value ? catalogue.byId.get(value) : undefined;
  // A plant added via "Add a plant that isn't listed" is chosen automatically on return.
  const knownOwn = useRef(new Set(data.customPlants.map((c) => c.id)));
  const [awaitingOwn, setAwaitingOwn] = useState(false);
  useEffect(() => {
    const fresh = data.customPlants.find((c) => !knownOwn.current.has(c.id));
    data.customPlants.forEach((c) => knownOwn.current.add(c.id));
    if (fresh && awaitingOwn) {
      setAwaitingOwn(false);
      onChange(fresh.id);
    }
  }, [data.customPlants, awaitingOwn, onChange]);
  const addOwn = () => {
    setOpen(false);
    setAwaitingOwn(true);
    router.push({ pathname: '/plant/custom', params: { name: q.trim() } });
  };
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small" style={{ fontWeight: '600' }}>Plant</T>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={current ? `Plant: ${current.commonName}. Change` : 'Choose a plant'} style={[styles.pickerButton, { borderColor: p.border, backgroundColor: p.surface }]}>
        <Ionicons name="leaf-outline" size={20} color={p.primary} />
        <T style={{ flex: 1 }}>{current ? current.commonName : 'Choose a plant…'}</T>
        <Ionicons name="chevron-down" size={20} color={p.textMuted} />
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: p.bg, padding: space.lg, gap: space.md, paddingTop: space.xxl }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="h2">Choose a plant</T>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </Row>
          <TextInput value={q} onChangeText={setQ} placeholder="Search, e.g. tomato, herbs, suitable for pots" placeholderTextColor={p.textMuted} accessibilityLabel="Search plants" autoFocus style={[styles.search, { borderColor: p.border, color: p.text, backgroundColor: p.surface }]} />
          <FlatList
            data={results}
            keyExtractor={(x) => x.id}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              <View style={{ paddingVertical: space.md, gap: space.xs }}>
                {q.trim() && !results.length ? <T variant="small" muted>{`"${q.trim()}" isn't in the plant list yet.`}</T> : null}
                <Button variant="secondary" icon="add" label="Add a plant that isn't listed" onPress={addOwn} />
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.commonName}
                style={({ pressed }) => [styles.pickRow, { borderColor: p.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <T style={{ fontWeight: '600' }}>{item.commonName}</T>
                <T variant="tiny" muted>{`${item.origin === 'yours' ? 'Your plant · ' : ''}${item.botanicalName ?? item.categories.join(', ')}`}</T>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

export function PlantLine({ plant, right, onPress }: { plant: PlantRecord; right?: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={plant.commonName}>
      <Row style={{ minHeight: TOUCH, justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '600' }}>{plant.commonName}</T>
          {plant.botanicalName ? <T variant="tiny" muted style={{ fontStyle: 'italic' }}>{plant.botanicalName}</T> : null}
        </View>
        {right}
      </Row>
    </Pressable>
  );
}

export { Chip };

const styles = StyleSheet.create({
  monthCell: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 6, borderWidth: 1.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { padding: space.xl, gap: space.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  dateInput: { flex: 1, minHeight: TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, textAlign: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 3 },
  taskIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pickerButton: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  search: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  pickRow: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: TOUCH },
});

export type { Month };
