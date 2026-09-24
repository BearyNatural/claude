/**
 * Garden area form. Only a name and type are required — "Back vegetable
 * patch, about 4 m × 1 m" is enough to be useful.
 */
import React from 'react';
import { View } from 'react-native';
import type { AreaType, Drainage, GardenArea, Irrigation, SoilObservation, SoilType } from '../../domain/types';
import { Chip, Choice, Field, Row, T } from '../components/primitives';
import { space } from '../theme/theme';

export type AreaDraft = Omit<GardenArea, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  'vegetable-bed': 'Vegetable bed',
  'raised-bed': 'Raised bed',
  'in-ground': 'In-ground garden',
  pot: 'Pot',
  'large-container': 'Large container',
  greenhouse: 'Greenhouse',
  orchard: 'Orchard',
  'food-forest': 'Food forest',
  'herb-garden': 'Herb garden',
  balcony: 'Balcony',
  trellis: 'Trellis',
  'seed-starting': 'Indoor seed-starting',
};

const SOIL: { value: SoilType; label: string }[] = [
  { value: 'sandy', label: 'Sandy' },
  { value: 'loam', label: 'Loam' },
  { value: 'clay', label: 'Clay' },
  { value: 'potting-mix', label: 'Potting mix' },
  { value: 'raised-bed-mix', label: 'Raised-bed mix' },
  { value: 'unknown', label: 'Not sure' },
];

const DRAINAGE: { value: Drainage; label: string; description: string }[] = [
  { value: 'fast', label: 'Water runs through very quickly', description: '' },
  { value: 'normal', label: 'Normal', description: '' },
  { value: 'stays-wet', label: 'Stays wet', description: '' },
  { value: 'unknown', label: 'Not sure', description: '' },
];

const OBS: { value: SoilObservation; label: string }[] = [
  { value: 'compacted', label: 'Compacted' },
  { value: 'hydrophobic', label: 'Hard to wet' },
  { value: 'rocky', label: 'Rocky' },
  { value: 'high-organic', label: 'Lots of organic matter' },
  { value: 'low-organic', label: 'Little organic matter' },
];

const IRRIGATION: { value: Irrigation; label: string }[] = [
  { value: 'hand', label: 'Hand watering' },
  { value: 'drip', label: 'Drip' },
  { value: 'sprinkler', label: 'Sprinkler' },
  { value: 'wicking', label: 'Wicking bed' },
  { value: 'none', label: 'None' },
];

export function parseNum(s: string): number | undefined {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function numText(n: number | undefined): string {
  return n === undefined ? '' : String(n);
}

export function AreaForm({ draft, onChange, showAdvanced = true, errors = {} }: { draft: AreaDraft; onChange: (d: AreaDraft) => void; showAdvanced?: boolean; errors?: Partial<Record<'name' | 'lengthM' | 'widthM' | 'sunHours', string>> }) {
  const container = draft.type === 'pot' || draft.type === 'large-container' || draft.type === 'balcony';
  const set = (patch: Partial<AreaDraft>) => onChange({ ...draft, ...patch });
  const toggleObs = (o: SoilObservation) => {
    const cur = draft.soilObservations ?? [];
    set({ soilObservations: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] });
  };
  return (
    <View style={{ gap: space.lg }}>
      <Field label="Name" value={draft.name} onChangeText={(t) => set({ name: t })} placeholder="e.g. Back vegetable patch" error={errors.name} />
      <View style={{ gap: space.sm }}>
        <T variant="small" style={{ fontWeight: '600' }}>Type</T>
        <Row wrap>
          {(Object.keys(AREA_TYPE_LABELS) as AreaType[]).map((t) => (
            <Chip key={t} label={AREA_TYPE_LABELS[t]} selected={draft.type === t} onPress={() => set({ type: t })} />
          ))}
        </Row>
      </View>
      {container ? (
        <Row gap={space.md} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Volume (litres)" value={numText(draft.container?.volumeL)} onChangeText={(t) => set({ container: { ...draft.container, volumeL: parseNum(t) } })} keyboardType="decimal-pad" hint="Optional" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Diameter (cm)" value={numText(draft.container?.diameterCm)} onChangeText={(t) => set({ container: { ...draft.container, diameterCm: parseNum(t) } })} keyboardType="decimal-pad" hint="Optional" />
          </View>
        </Row>
      ) : (
        <Row gap={space.md} align="flex-start">
          <View style={{ flex: 1 }}>
            <Field label="Length (m)" value={numText(draft.lengthM)} onChangeText={(t) => set({ lengthM: parseNum(t) })} keyboardType="decimal-pad" hint="Approximate is fine" error={errors.lengthM} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Width (m)" value={numText(draft.widthM)} onChangeText={(t) => set({ widthM: parseNum(t) })} keyboardType="decimal-pad" error={errors.widthM} />
          </View>
        </Row>
      )}
      <Field label="Hours of direct sun per day" value={numText(draft.sunHours)} onChangeText={(t) => set({ sunHours: parseNum(t) })} keyboardType="decimal-pad" hint="Optional — helps us warn about sun-loving crops in shady spots" error={errors.sunHours} />
      {showAdvanced ? (
        <>
          <View style={{ gap: space.sm }}>
            <T variant="small" style={{ fontWeight: '600' }}>Soil type (optional)</T>
            <Row wrap>
              {SOIL.map((s) => (
                <Chip key={s.value} label={s.label} selected={draft.soilType === s.value} onPress={() => set({ soilType: draft.soilType === s.value ? undefined : s.value })} />
              ))}
            </Row>
          </View>
          <Choice<Drainage> label="Drainage (optional)" options={DRAINAGE} value={draft.drainage} onChange={(d) => set({ drainage: d })} />
          <View style={{ gap: space.sm }}>
            <T variant="small" style={{ fontWeight: '600' }}>Anything else about the soil?</T>
            <Row wrap>
              {OBS.map((o) => (
                <Chip key={o.value} label={o.label} selected={(draft.soilObservations ?? []).includes(o.value)} onPress={() => toggleObs(o.value)} />
              ))}
            </Row>
          </View>
          <View style={{ gap: space.sm }}>
            <T variant="small" style={{ fontWeight: '600' }}>Watering (optional)</T>
            <Row wrap>
              {IRRIGATION.map((o) => (
                <Chip key={o.value} label={o.label} selected={draft.irrigation === o.value} onPress={() => set({ irrigation: draft.irrigation === o.value ? undefined : o.value })} />
              ))}
            </Row>
          </View>
          <Field label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set({ notes: t || undefined })} multiline />
        </>
      ) : null}
    </View>
  );
}

export function validateAreaDraft(d: AreaDraft) {
  const errors: Partial<Record<'name' | 'lengthM' | 'widthM' | 'sunHours', string>> = {};
  if (!d.name.trim()) errors.name = 'Give this area a name.';
  if (d.lengthM !== undefined && d.lengthM > 1000) errors.lengthM = 'That seems very large — check the units (metres).';
  if (d.widthM !== undefined && d.widthM > 1000) errors.widthM = 'That seems very large — check the units (metres).';
  if (d.sunHours !== undefined && d.sunHours > 16) errors.sunHours = 'Sun hours should be between 0 and 16.';
  return errors;
}

export function soilAdvice(area: GardenArea): string[] {
  const tips: string[] = [];
  const obs = area.soilObservations ?? [];
  if (area.soilType === 'clay' || area.drainage === 'stays-wet') tips.push('Heavy or wet soil: add compost and consider raised beds or mounds for crops that need good drainage (e.g. citrus, rosemary, blueberries).');
  if (area.soilType === 'sandy' || area.drainage === 'fast') tips.push('Sandy, fast-draining soil dries out and loses nutrients quickly: add compost regularly and mulch to hold moisture.');
  if (obs.includes('compacted')) tips.push('Compacted soil: loosen it before sowing root crops — compaction commonly causes forked carrots and parsnips.');
  if (obs.includes('hydrophobic')) tips.push('Water-repellent soil: water slowly in several passes, add compost, and consider a soil wetter.');
  if (obs.includes('low-organic')) tips.push('Low organic matter: dig in compost or well-rotted manure a few weeks before planting hungry crops.');
  if (obs.includes('rocky')) tips.push('Rocky soil: shallow-rooted crops or raised beds may be easier than long root crops.');
  return tips;
}
