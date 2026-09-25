/**
 * Reusable Garden Profile form sections (used by onboarding and the profile
 * screen) so both paths share validation and wording.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { LOCALITIES } from '../../data/localities';
import { CLIMATE_ZONES, ZONE_IDS } from '../../domain/climate';
import { WEEKDAY_SHORT } from '../../domain/dates';
import { inferClimateFromCoordinates, inferClimateFromPostcode, normalisePostcode, stateForPostcode, STATES, timezoneFor } from '../../domain/location';
import type { AustralianState, ClimateZoneId, FrostRisk, GardenLocation, GardeningGoal, ReminderPreferences, TimeBudget, Weekday } from '../../domain/types';
import { TIME_BUDGET_LABELS } from '../../domain/workload';
import { coordinatesForPostcode, offlineCandidates, onlineCandidates, type LocationCandidate } from '../../services/location/geocode';
import { InfoTip } from '../components/garden';
import { Badge, Button, Card, Chip, Choice, Field, Notice, Row, T } from '../components/primitives';
import { space } from '../theme/theme';

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function LocationPicker({ value, onChange }: { value: GardenLocation | null; onChange: (loc: GardenLocation) => void }) {
  const [q, setQ] = useState('');
  const [online, setOnline] = useState<LocationCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const offline = useMemo(() => offlineCandidates(q), [q]);

  const searchOnline = async () => {
    setSearching(true);
    setError(null);
    try {
      const r = await onlineCandidates(q, (u, i) => fetch(u, i));
      setOnline(r);
      if (!r.length) setError('No Australian places found online. Try a nearby town, or set your state and climate manually.');
    } catch {
      setError('Online search is unavailable (you may be offline). Pick a nearby town from the list, or set things manually.');
    } finally {
      setSearching(false);
    }
  };

  const candidates = [...offline, ...(online ?? []).filter((o) => !offline.some((f) => f.label === o.label && f.sublabel === o.sublabel))];
  const isPostcode = /^\d+$/.test(q.trim());
  const pc = isPostcode ? normalisePostcode(q) : null;

  return (
    <View style={{ gap: space.md }}>
      {value ? (
        <Card tone="good">
          <T variant="h3">{[value.suburb, value.state, value.postcode].filter(Boolean).join(' ') || 'Location set'}</T>
          {value.suggestedZone ? <T variant="small">Suggested climate: {CLIMATE_ZONES[value.suggestedZone].name}</T> : null}
          {value.suggestedZoneReason ? <T variant="tiny" muted>{value.suggestedZoneReason}</T> : null}
        </Card>
      ) : null}
      <Field label="Suburb, town or postcode" value={q} onChangeText={(t) => { setQ(t); setOnline(null); }} placeholder="e.g. Toowoomba or 4350" hint="We only need your general area — never your exact address or GPS." />
      {candidates.slice(0, 8).map((c) => (
        <Button key={c.key} variant="secondary" label={`${c.label} — ${c.sublabel}`} icon={c.source === 'online-geocoder' ? 'globe-outline' : 'location-outline'} onPress={() => { onChange(c.location); setQ(''); setOnline(null); }} />
      ))}
      {pc && !offline.length ? <Notice tone="caution">{`We couldn't find postcode ${pc}. Check the number, try your suburb name, or set your area manually.`}</Notice> : null}
      {q.trim().length >= 3 && !isPostcode ? <Button variant="ghost" icon="search" label={searching ? 'Searching…' : 'Search more places online'} onPress={searchOnline} loading={searching} accessibilityHint="Sends your search text to the Open-Meteo place search service" /> : null}
      {error ? <Notice tone="caution">{error}</Notice> : null}
      <Button variant="ghost" icon="create-outline" label={manual ? 'Hide manual setup' : 'Set my area manually'} onPress={() => setManual((m) => !m)} />
      {manual ? <ManualLocation onChange={onChange} /> : null}
    </View>
  );
}

function ManualLocation({ onChange }: { onChange: (loc: GardenLocation) => void }) {
  const [state, setState] = useState<AustralianState | undefined>();
  const [postcode, setPostcode] = useState('');
  const pc = normalisePostcode(postcode);
  const pcState = pc ? stateForPostcode(pc) : null;
  const effectiveState = state ?? pcState ?? undefined;
  // Approximate postcode centre (full postcode list), so live weather works and the
  // climate comes from the nearest reference town rather than a numerically close postcode.
  const coords = pc ? coordinatesForPostcode(pc) : null;
  const inference = coords ? inferClimateFromCoordinates(LOCALITIES, coords.lat, coords.lon, undefined, effectiveState) : pc ? inferClimateFromPostcode(LOCALITIES, pc) : null;
  return (
    <Card>
      <Field label="Postcode (optional)" value={postcode} onChangeText={setPostcode} keyboardType="number-pad" hint="Add your postcode to get live weather for your area." error={postcode && !pcState ? 'That doesn\'t look like an Australian postcode.' : null} />
      <T variant="small" style={{ fontWeight: '600' }}>State or territory</T>
      <Row wrap>
        {STATES.map((s) => (
          <Chip key={s.id} label={s.id} selected={effectiveState === s.id} onPress={() => setState(s.id)} />
        ))}
      </Row>
      {inference ? <T variant="tiny" muted>{inference.reason}</T> : null}
      <Button
        label="Use this"
        disabled={!effectiveState}
        onPress={() =>
          onChange({
            postcode: pc ?? undefined,
            state: effectiveState,
            timezone: timezoneFor(effectiveState!, pc ?? undefined),
            suggestedZone: inference?.zone,
            suggestedZoneReason: inference?.reason ?? 'Choose the climate zone that best matches your area below.',
            suggestedFrostRisk: inference?.frost,
            approxLatitude: coords?.lat,
            approxLongitude: coords?.lon,
            source: 'manual',
          })
        }
      />
    </Card>
  );
}

export function ZonePicker({ location, onChange }: { location: GardenLocation; onChange: (loc: GardenLocation) => void }) {
  const current = location.overrideZone ?? location.suggestedZone;
  return (
    <View style={{ gap: space.md }}>
      <Row gap={4}>
        <T variant="h3">Climate zone</T>
        <InfoTip termId="microclimate" />
      </Row>
      <T variant="small" muted>
        {location.suggestedZone
          ? `We suggest ${CLIMATE_ZONES[location.suggestedZone].name.toLowerCase()}. If your garden is warmer, cooler or frostier than the area around it, choose what fits better.`
          : 'Choose the zone that best describes your area.'}
      </T>
      <Choice<ClimateZoneId>
        options={ZONE_IDS.map((z) => ({
          value: z,
          label: `${CLIMATE_ZONES[z].name}${location.suggestedZone === z ? ' (suggested)' : ''}`,
          description: `${CLIMATE_ZONES[z].shortDescription} e.g. ${CLIMATE_ZONES[z].examples.slice(0, 3).join(', ')}.`,
        }))}
        value={current}
        onChange={(z) => onChange({ ...location, overrideZone: z === location.suggestedZone ? undefined : z })}
      />
      {location.overrideZone ? <Badge tone="info" icon="create-outline" label="You've chosen your own zone" /> : null}
      <FrostPicker location={location} onChange={onChange} />
    </View>
  );
}

const FROST_OPTIONS: { value: FrostRisk; label: string; description: string }[] = [
  { value: 'none', label: 'No frost', description: 'Frost essentially never happens here.' },
  { value: 'light', label: 'Occasional light frost', description: 'A few mild frosts in the coldest weeks, if any.' },
  { value: 'moderate', label: 'Regular frosts', description: 'Frosts most winters.' },
  { value: 'heavy', label: 'Heavy frosts', description: 'Frequent or hard frosts; sometimes snow.' },
];

function FrostPicker({ location, onChange }: { location: GardenLocation; onChange: (loc: GardenLocation) => void }) {
  const value = location.overrideFrostRisk ?? location.suggestedFrostRisk;
  return (
    <Choice<FrostRisk>
      label="Frost in your garden"
      options={FROST_OPTIONS.map((o) => ({ ...o, label: `${o.label}${location.suggestedFrostRisk === o.value ? ' (suggested)' : ''}` }))}
      value={value}
      onChange={(f) => onChange({ ...location, overrideFrostRisk: f === location.suggestedFrostRisk ? undefined : f })}
    />
  );
}

// ---------------------------------------------------------------------------
// Time, goals, reminders
// ---------------------------------------------------------------------------

const TIME_HELP: Record<TimeBudget, string> = {
  lt1: 'We\'ll keep suggestions small and low-maintenance.',
  '1to2': 'A few manageable jobs each week.',
  '2to4': 'Room for a productive vegetable garden.',
  '4to8': 'A large, busy garden.',
  '8plus': 'Plenty of time for an ambitious garden.',
};

export function TimeBudgetPicker({ value, onChange }: { value: TimeBudget; onChange: (v: TimeBudget) => void }) {
  return (
    <Choice<TimeBudget>
      label="About how much time can you realistically spend gardening each week?"
      options={(Object.keys(TIME_BUDGET_LABELS) as TimeBudget[]).map((k) => ({ value: k, label: TIME_BUDGET_LABELS[k], description: TIME_HELP[k] }))}
      value={value}
      onChange={onChange}
    />
  );
}

export const GOAL_LABELS: Record<GardeningGoal, string> = {
  'fresh-veg': 'Some fresh vegetables',
  supplement: 'Supplement grocery shopping',
  maximise: 'Maximise food production',
  herbs: 'Herbs',
  fruit: 'Fruit',
  flowers: 'Flowers',
  pollinators: 'Pollinator-friendly garden',
  native: 'Native plants',
  'low-maintenance': 'Low maintenance',
  learning: 'Learning / experimenting',
  'self-sufficiency': 'Food security / self-sufficiency',
};

export function GoalsPicker({ value, onChange }: { value: GardeningGoal[]; onChange: (v: GardeningGoal[]) => void }) {
  const toggle = (g: GardeningGoal) => onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]);
  return (
    <View style={{ gap: space.sm }}>
      <T variant="small" style={{ fontWeight: '600' }}>What would you like from your garden? Choose any.</T>
      <Row wrap>
        {(Object.keys(GOAL_LABELS) as GardeningGoal[]).map((g) => (
          <Chip key={g} label={GOAL_LABELS[g]} selected={value.includes(g)} onPress={() => toggle(g)} />
        ))}
      </Row>
    </View>
  );
}

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function ReminderForm({ value, onChange }: { value: ReminderPreferences; onChange: (v: ReminderPreferences) => void }) {
  const toggleDay = (list: Weekday[], d: Weekday) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(value.reminderTime);
  return (
    <View style={{ gap: space.md }}>
      <Choice<'on' | 'off'>
        label="Reminders"
        options={[
          { value: 'on', label: 'Yes, remind me', description: 'Local notifications on this device. No account or server.' },
          { value: 'off', label: 'No reminders', description: 'You can still see everything in the app.' },
        ]}
        value={value.enabled ? 'on' : 'off'}
        onChange={(v) => onChange({ ...value, enabled: v === 'on' })}
      />
      <View style={{ gap: space.sm }}>
        <T variant="small" style={{ fontWeight: '600' }}>Which days do you usually garden?</T>
        <Row wrap>
          {WEEKDAYS.map((d) => (
            <Chip key={d} label={WEEKDAY_SHORT[d]} selected={value.gardeningDays.includes(d)} onPress={() => onChange({ ...value, gardeningDays: toggleDay(value.gardeningDays, d) })} />
          ))}
        </Row>
      </View>
      {value.enabled ? (
        <>
          <Field label="Reminder time (24-hour)" value={value.reminderTime} onChangeText={(t) => onChange({ ...value, reminderTime: t })} placeholder="08:00" keyboardType="numbers-and-punctuation" error={timeOk ? null : 'Use HH:MM, e.g. 07:30'} />
          <Choice<ReminderPreferences['mode']>
            label="How often?"
            options={[
              { value: 'gardening-days', label: 'On my gardening days', description: 'One grouped message per gardening day (recommended).' },
              { value: 'daily-summary', label: 'Daily summary', description: 'A short message on days with something to do.' },
              { value: 'weekly', label: 'Once a week', description: 'One message for the week ahead.' },
            ]}
            value={value.mode}
            onChange={(m) => onChange({ ...value, mode: m })}
          />
          <View style={{ gap: space.sm }}>
            <T variant="small" style={{ fontWeight: '600' }}>Days with no reminders</T>
            <Row wrap>
              {WEEKDAYS.map((d) => (
                <Chip key={d} label={WEEKDAY_SHORT[d]} selected={value.quietDays.includes(d)} onPress={() => onChange({ ...value, quietDays: toggleDay(value.quietDays, d) })} />
              ))}
            </Row>
          </View>
        </>
      ) : null}
    </View>
  );
}

export const DEFAULT_REMINDERS: ReminderPreferences = { enabled: false, gardeningDays: [6], reminderTime: '08:00', quietDays: [], mode: 'gardening-days' };
