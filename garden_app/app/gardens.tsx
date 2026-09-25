/**
 * Your gardens: switch between them, add one (e.g. a community garden plot or
 * a relative's place), rename or remove. Each garden has its own location,
 * climate, weather, areas, plantings and notes.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { CLIMATE_ZONES, effectiveZone } from '../src/domain/climate';
import { gardenContents } from '../src/domain/gardens';
import { describeLocation } from '../src/domain/location';
import type { GardenLocation } from '../src/domain/types';
import { useGardenView } from '../src/state/hooks';
import { Badge, Button, Card, Field, Notice, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { LocationPicker, ZonePicker } from '../src/ui/forms/profileForms';
import { space } from '../src/ui/theme/theme';

export default function Gardens() {
  const { store, gardens, garden, allData } = useGardenView();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState<GardenLocation | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'caution'; text: string } | null>(null);

  const add = async () => {
    if (!name.trim() || !location) return;
    const site = await store.saveGarden({ name, location });
    await store.setActiveGarden(site.id);
    setAdding(false);
    setName('');
    setLocation(null);
    router.back();
  };

  return (
    <Screen>
      <T variant="small" muted>Keep separate gardens — for example home, a community garden plot or a relative&apos;s place. Each has its own location, weather, areas, plantings and notes. Your wish list, your own plants and your settings are shared.</T>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Section title="Your gardens">
        {gardens.map((g) => {
          const c = gardenContents(allData, g.id);
          const zone = effectiveZone(g.location);
          const current = garden?.id === g.id;
          return (
            <Card key={g.id} tone={current ? 'good' : undefined}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="h3" style={{ flex: 1 }}>{g.name}</T>
                {current ? <Badge tone="good" icon="checkmark" label="Showing" /> : null}
              </Row>
              <T variant="small" muted>{`${describeLocation(g.location)}${zone ? ` · ${CLIMATE_ZONES[zone].name}` : ''}`}</T>
              <T variant="tiny" muted>{`${c.areas} area${c.areas === 1 ? '' : 's'} · ${c.plantings} planting${c.plantings === 1 ? '' : 's'} · ${c.notes} note${c.notes === 1 ? '' : 's'}`}</T>
              {renaming === g.id ? (
                <View style={{ gap: space.sm }}>
                  <Field label="Name" value={newName} onChangeText={setNewName} />
                  <Row gap={space.sm}>
                    <Button compact label="Save" icon="checkmark" disabled={!newName.trim()} onPress={async () => { await store.renameGarden(g.id, newName); setRenaming(null); }} />
                    <Button compact variant="secondary" label="Cancel" onPress={() => setRenaming(null)} />
                  </Row>
                </View>
              ) : (
                <Row wrap gap={space.sm}>
                  {!current ? <Button compact icon="swap-horizontal" label="Show this garden" onPress={async () => { await store.setActiveGarden(g.id); router.back(); }} /> : null}
                  <Button compact variant="secondary" icon="create-outline" label="Rename" onPress={() => { setRenaming(g.id); setNewName(g.name); }} />
                  {!g.isHome ? (
                    <Button
                      compact
                      variant="ghost"
                      icon="trash-outline"
                      label="Remove"
                      onPress={async () => {
                        const r = await store.deleteGarden(g.id);
                        setMessage(r.ok ? { tone: 'good', text: `${g.name} was removed.` } : { tone: 'caution', text: `${g.name} can't be removed yet. ${r.reason}` });
                      }}
                    />
                  ) : null}
                </Row>
              )}
            </Card>
          );
        })}
      </Section>

      {adding ? (
        <Section title="Add a garden">
          <Card>
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Community garden plot" />
            <T variant="small" style={{ fontWeight: '600' }}>Where is it?</T>
            <LocationPicker value={location} onChange={setLocation} />
            {location ? <ZonePicker location={location} onChange={setLocation} /> : null}
            <Row gap={space.sm}>
              <Button icon="checkmark" label="Add garden" disabled={!name.trim() || !location} onPress={add} />
              <Button variant="secondary" label="Cancel" onPress={() => setAdding(false)} />
            </Row>
          </Card>
        </Section>
      ) : (
        <Button icon="add" label="Add a garden" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
