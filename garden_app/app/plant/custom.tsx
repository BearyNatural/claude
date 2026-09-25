/**
 * Add (or edit) a plant that isn't in the catalogue. Only the name is needed;
 * everything else is optional and left as "unknown" if blank. The botanical
 * name can be looked up in the Atlas of Living Australia.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { MONTH_SHORT } from '../../src/domain/dates';
import type { Lifecycle, PlantCategory, SunNeed, SupportNeed } from '../../src/domain/plantTypes';
import type { CustomPlant, Month, StartMethod } from '../../src/domain/types';
import { searchAlaNames, type AlaName } from '../../src/services/plants/alaNames';
import { useGardenView } from '../../src/state/hooks';
import { Button, Chip, Choice, Field, Notice, Row, Screen, T } from '../../src/ui/components/primitives';
import { METHOD_LABELS } from '../../src/ui/labels';
import { space } from '../../src/ui/theme/theme';

const TYPES: { value: PlantCategory; label: string }[] = [
  { value: 'vegetable', label: 'Vegetable' },
  { value: 'herb', label: 'Herb' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'tree', label: 'Tree' },
  { value: 'flower', label: 'Flower' },
  { value: 'native', label: 'Australian native' },
  { value: 'pollinator', label: 'Attracts pollinators' },
];

type Frost = NonNullable<CustomPlant['frost']> | 'unsure';
type Pot = 'yes' | 'no' | 'unsure';

function Label({ children }: { children: string }) {
  return <T variant="small" style={{ fontWeight: '600' }}>{children}</T>;
}

export default function CustomPlantScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const { data, store } = useGardenView();
  const existing = params.id ? data.customPlants.find((c) => c.id === params.id) : undefined;

  const [name, setName] = useState(existing?.commonName ?? params.name ?? '');
  const [botanical, setBotanical] = useState(existing?.botanicalName ?? '');
  const [family, setFamily] = useState(existing?.familyName ?? '');
  const [alaGuid, setAlaGuid] = useState(existing?.alaGuid);
  const [types, setTypes] = useState<PlantCategory[]>(existing?.categories ?? []);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(existing?.lifecycle ?? 'perennial');
  const [methods, setMethods] = useState<StartMethod[]>(existing?.startMethods ?? ['seedling']);
  const [months, setMonths] = useState<Month[]>(existing?.plantMonths ?? []);
  const [sun, setSun] = useState<SunNeed>(existing?.sun ?? 'full-sun');
  const [frost, setFrost] = useState<Frost>(existing?.frost ?? 'unsure');
  const [support, setSupport] = useState<SupportNeed>(existing?.support ?? 'none');
  const [pot, setPot] = useState<Pot>(existing?.potOk === true ? 'yes' : existing?.potOk === false ? 'no' : 'unsure');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const [lookup, setLookup] = useState<AlaName[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = <V,>(list: V[], v: V, set: (x: V[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const lookUp = async () => {
    setLooking(true);
    setLookupError(null);
    try {
      const r = await searchAlaNames(botanical.trim() || name, (u, i) => fetch(u, i));
      setLookup(r);
      if (!r.length) setLookupError('No matching plant names found. That\'s fine — many garden varieties and hybrids aren\'t listed. You can leave the botanical name blank.');
    } catch {
      setLookupError('The name lookup is unavailable right now (you may be offline). You can still save the plant.');
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setError('Give the plant a name.');
    setSaving(true);
    setError(null);
    try {
      await store.saveCustomPlant({
        id: existing?.id,
        commonName: name.trim(),
        botanicalName: botanical.trim() || undefined,
        familyName: family.trim() || undefined,
        alaGuid: botanical.trim() ? alaGuid : undefined,
        categories: types,
        lifecycle,
        startMethods: methods.length ? methods : ['seedling'],
        plantMonths: months.length ? [...months].sort((a, b) => a - b) : undefined,
        sun,
        frost: frost === 'unsure' ? undefined : frost,
        support,
        potOk: pot === 'unsure' ? undefined : pot === 'yes',
        notes: notes.trim() || undefined,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? `Edit ${existing.commonName}` : 'Add a plant' }} />
      <T variant="small" muted>For anything that isn&apos;t in the plant list yet — a particular variety, a hybrid, a native. Only the name is needed; leave anything you&apos;re unsure of blank.</T>

      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Plumcot 'Flavor King', Lilly pilly" />
      <View style={{ gap: space.sm }}>
        <Field label="Botanical name (optional)" value={botanical} onChangeText={(t) => { setBotanical(t); setAlaGuid(undefined); }} placeholder="e.g. Syzygium australe" />
        <Button compact variant="ghost" icon="search" label={looking ? 'Looking up…' : 'Look up the botanical name'} loading={looking} disabled={(botanical.trim() || name.trim()).length < 3} onPress={lookUp} accessibilityHint="Sends the name to the Atlas of Living Australia species search" />
        {lookup?.map((n) => (
          <Button
            key={n.scientificName}
            variant="secondary"
            label={`${n.scientificName}${n.commonName ? ` — ${n.commonName}` : ''}${n.family ? ` (${n.family})` : ''}`}
            onPress={() => {
              setBotanical(n.scientificName);
              setFamily(n.family ?? '');
              setAlaGuid(n.guid);
              if (!name.trim() && n.commonName) setName(n.commonName);
              setLookup(null);
            }}
          />
        ))}
        {lookupError ? <Notice tone="info">{lookupError}</Notice> : null}
        {family ? <T variant="tiny" muted>{`Family: ${family}`}</T> : null}
        <T variant="tiny" muted>Name lookup by the Atlas of Living Australia — names only, not growing advice.</T>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>What kind of plant is it?</Label>
        <Row wrap>
          {TYPES.map((t) => (
            <Chip key={t.value} label={t.label} selected={types.includes(t.value)} onPress={() => toggle(types, t.value, setTypes)} />
          ))}
        </Row>
      </View>

      <Choice<Lifecycle>
        label="How long does it live?"
        options={[
          { value: 'annual', label: 'One season (annual)' },
          { value: 'biennial', label: 'Two seasons (biennial)' },
          { value: 'perennial', label: 'Many years (perennial, trees, shrubs)' },
        ]}
        value={lifecycle}
        onChange={setLifecycle}
      />

      <View style={{ gap: space.sm }}>
        <Label>How do you usually start it?</Label>
        <Row wrap>
          {(Object.keys(METHOD_LABELS) as StartMethod[]).map((m) => (
            <Chip key={m} label={METHOD_LABELS[m]} selected={methods.includes(m)} onPress={() => toggle(methods, m, setMethods)} />
          ))}
        </Row>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>When do you plant it? (optional)</Label>
        <T variant="tiny" muted>Choose the months that work in your garden. These appear on its plant page and in &quot;Plant now&quot;.</T>
        <Row wrap>
          {MONTH_SHORT.map((m, i) => (
            <Chip key={m} label={m} selected={months.includes((i + 1) as Month)} onPress={() => toggle(months, (i + 1) as Month, setMonths)} />
          ))}
        </Row>
      </View>

      <Choice<SunNeed>
        label="Sun"
        options={[
          { value: 'full-sun', label: 'Full sun' },
          { value: 'part-shade', label: 'Part shade' },
          { value: 'shade-tolerant', label: 'Copes with shade' },
        ]}
        value={sun}
        onChange={setSun}
      />
      <Choice<Frost>
        label="Frost"
        options={[
          { value: 'unsure', label: 'Not sure' },
          { value: 'tender', label: 'Damaged by frost' },
          { value: 'half-hardy', label: 'Copes with light frost' },
          { value: 'hardy', label: 'Frost hardy' },
        ]}
        value={frost}
        onChange={setFrost}
      />
      <View style={{ gap: space.sm }}>
        <Label>Support</Label>
        <Row wrap>
          {([['none', 'None'], ['stake', 'Stake'], ['trellis', 'Trellis / climber'], ['cage', 'Cage']] as [SupportNeed, string][]).map(([v, l]) => (
            <Chip key={v} label={l} selected={support === v} onPress={() => setSupport(v)} />
          ))}
        </Row>
      </View>
      <View style={{ gap: space.sm }}>
        <Label>Grows well in a pot?</Label>
        <Row wrap>
          {([['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] as [Pot, string][]).map(([v, l]) => (
            <Chip key={v} label={l} selected={pot === v} onPress={() => setPot(v)} />
          ))}
        </Row>
      </View>
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Care tips, where you bought it, variety details…" />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button icon="checkmark" label={existing ? 'Save changes' : 'Add plant'} onPress={save} loading={saving} disabled={!name.trim()} />

      {existing ? (
        confirmDelete ? (
          <Notice
            tone="caution"
            title={`Remove ${existing.commonName}?`}
            action={
              <Row gap={space.sm}>
                <Button
                  compact
                  variant="danger"
                  label="Remove"
                  onPress={async () => {
                    const r = await store.deleteCustomPlant(existing.id);
                    if (r.ok) router.back();
                    else {
                      setError(`It's still used by ${r.inUse} planting${r.inUse > 1 ? 's' : ''} or wish-list entr${r.inUse > 1 ? 'ies' : 'y'}. Remove those first.`);
                      setConfirmDelete(false);
                    }
                  }}
                />
                <Button compact variant="secondary" label="Keep" onPress={() => setConfirmDelete(false)} />
              </Row>
            }
          >
            It will be removed from your plant list.
          </Notice>
        ) : (
          <Button variant="ghost" icon="trash-outline" label="Remove this plant" onPress={() => setConfirmDelete(true)} />
        )
      ) : null}
    </Screen>
  );
}
