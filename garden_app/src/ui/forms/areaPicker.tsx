/**
 * "Where is it growing?" — shared by adding and editing a planting.
 * A planting can be in no particular area, in one or more existing areas, or
 * in a brand-new pot of its own (created when the planting is saved).
 */
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { newPotName } from '../../domain/plantingAreas';
import type { GardenArea } from '../../domain/types';
import type { GardenStore } from '../../state/gardenStore';
import { Button, Chip, Field, Row, T } from '../components/primitives';
import { space } from '../theme/theme';
import { parseNum } from './areaForm';

export interface NewPot {
  /** Create a pot just for this planting when it's saved. */
  enabled: boolean;
  diameterCm?: number;
}

export function AreaPicker({
  areas,
  value,
  onChange,
  newPot,
  onNewPotChange,
}: {
  areas: readonly GardenArea[];
  value: string[];
  onChange: (ids: string[]) => void;
  newPot: NewPot;
  onNewPotChange: (p: NewPot) => void;
}) {
  const [diameter, setDiameter] = useState(newPot.diameterCm ? String(newPot.diameterCm) : '');
  const live = areas.filter((a) => !a.archived || value.includes(a.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const nothing = value.length === 0 && !newPot.enabled;

  return (
    <View style={{ gap: space.sm }}>
      <T variant="small" style={{ fontWeight: '600' }}>Where?</T>
      <T variant="tiny" muted>Choose one or more areas — flowers and herbs are often dotted through several beds.</T>
      <Row wrap>
        <Chip label="No particular area" selected={nothing} onPress={() => { onChange([]); onNewPotChange({ enabled: false }); }} />
        {live.map((a) => (
          <Chip key={a.id} label={a.name} selected={value.includes(a.id)} onPress={() => toggle(a.id)} />
        ))}
        <Chip icon="add" label="Its own new pot" selected={newPot.enabled} onPress={() => onNewPotChange({ ...newPot, enabled: !newPot.enabled })} />
      </Row>
      {newPot.enabled ? (
        <Field
          label="Pot size across the top, cm (optional)"
          value={diameter}
          onChangeText={(t) => { setDiameter(t); onNewPotChange({ enabled: true, diameterCm: parseNum(t) }); }}
          keyboardType="decimal-pad"
          hint="A pot is added to My Garden for this plant when you save. You can rename it or add details later."
        />
      ) : null}
      <Button compact variant="ghost" icon="create-outline" label="Set up a new garden area" onPress={() => router.push({ pathname: '/area/edit', params: { returnTo: 'back' } })} />
    </View>
  );
}

/**
 * When the gardener sets up a new area from this screen and comes back,
 * select it for them.
 */
export function useSelectNewAreas(areas: readonly GardenArea[], onNew: (ids: string[]) => void) {
  const known = useRef(new Set(areas.map((a) => a.id)));
  useEffect(() => {
    const fresh = areas.filter((a) => !known.current.has(a.id)).map((a) => a.id);
    if (!fresh.length) return;
    fresh.forEach((id) => known.current.add(id));
    onNew(fresh);
  }, [areas, onNew]);
}

/** Final area ids for a planting, creating its new pot first if one was asked for. */
export async function resolveAreaIds(store: GardenStore, plantName: string, ids: string[], newPot: NewPot, areas: readonly GardenArea[]): Promise<string[]> {
  if (!newPot.enabled) return ids;
  const pot = await store.saveArea({
    name: newPotName(plantName, areas),
    type: 'pot',
    soilType: 'potting-mix',
    ...(newPot.diameterCm ? { container: { diameterCm: newPot.diameterCm } } : {}),
  });
  return [...ids, pot.id];
}
