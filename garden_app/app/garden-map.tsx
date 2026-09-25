/**
 * Garden map (optional): find the property, then trace garden areas on
 * satellite imagery to measure them. The address and outlines stay on this
 * device; only the address search text (OpenStreetMap) and map image requests
 * (Esri) leave the phone.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { outlineDimensionsM, polygonAreaM2, roundTenth, type LatLon } from '../src/domain/geometry';
import type { AreaType } from '../src/domain/types';
import { searchAddress, ADDRESS_SEARCH_ATTRIBUTION, type AddressResult } from '../src/services/location/addressSearch';
import { coordinatesForPostcode } from '../src/services/location/geocode';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Chip, Field, Notice, Row, T } from '../src/ui/components/primitives';
import { AREA_TYPE_LABELS } from '../src/ui/forms/areaForm';
import GardenMap from '../src/ui/map/GardenMap';
import { space, usePalette } from '../src/ui/theme/theme';

/** Area types it makes sense to trace from above. */
const MAPPABLE: AreaType[] = ['vegetable-bed', 'raised-bed', 'in-ground', 'herb-garden', 'orchard', 'food-forest', 'greenhouse', 'balcony', 'trellis'];

function describe(points: LatLon[]): string {
  if (points.length < 3) return points.length ? `${points.length} corner${points.length > 1 ? 's' : ''} — keep tapping around the edge.` : 'Tap each corner of the garden bed on the map.';
  const m2 = polygonAreaM2(points);
  const d = outlineDimensionsM(points);
  return `About ${roundTenth(m2)} m²${d ? ` · roughly ${roundTenth(d.lengthM)} m × ${roundTenth(d.widthM)} m` : ''}`;
}

export default function GardenMapScreen() {
  const { areaId } = useLocalSearchParams<{ areaId?: string }>();
  const { data, store, profile } = useGardenView();
  const p = usePalette();
  const editing = areaId ? data.areas.find((a) => a.id === areaId) : undefined;

  const fallback = useMemo(() => {
    const loc = profile?.location;
    if (loc?.approxLatitude !== undefined && loc.approxLongitude !== undefined) return { lat: loc.approxLatitude, lon: loc.approxLongitude };
    const pc = coordinatesForPostcode(loc?.postcode);
    return pc ? { lat: pc.lat, lon: pc.lon } : null;
  }, [profile]);
  const property = profile?.property;
  const [useSuburb, setUseSuburb] = useState(false);
  const start = property ?? (useSuburb ? fallback : null);

  // Address search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [findingAddress, setFindingAddress] = useState(false);

  // Drawing
  const [drawing, setDrawing] = useState(!!editing);
  const [draft, setDraft] = useState<LatLon[]>(editing?.outline ?? []);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<AreaType>('vegetable-bed');
  const [zoom, setZoom] = useState(property?.zoom ?? 19);
  const [recentreKey, setRecentreKey] = useState('start');
  const [saving, setSaving] = useState(false);

  const outlines = useMemo(
    () => data.areas.filter((a) => !a.archived && a.outline && a.id !== editing?.id).map((a) => ({ id: a.id, name: a.name, points: a.outline! })),
    [data.areas, editing?.id],
  );
  const centre = useMemo(() => {
    if (editing?.outline?.length) {
      const o = editing.outline;
      return { lat: o.reduce((s, x) => s + x.lat, 0) / o.length, lon: o.reduce((s, x) => s + x.lon, 0) / o.length };
    }
    return start ?? { lat: -27.47, lon: 153.02 };
  }, [editing, start]);

  const onTap = useCallback(async (pt: LatLon) => setDraft((d) => [...d, pt]), []);
  const onZoom = useCallback(async (z: number) => setZoom(z), []);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const r = await searchAddress(query, (u, i) => fetch(u, i));
      setResults(r);
      if (!r.length) setSearchError('No matching address found. Try including the suburb, e.g. "12 Example St, Strathpine".');
    } catch {
      setSearchError('Address search is unavailable right now (you may be offline). You can start from your suburb and move the map instead.');
    } finally {
      setSearching(false);
    }
  };

  const chooseAddress = async (r: AddressResult) => {
    await store.setProperty({ lat: r.lat, lon: r.lon, label: r.label, zoom: 19 });
    setResults(null);
    setQuery('');
    setFindingAddress(false);
    setRecentreKey(`addr-${r.lat},${r.lon}`);
  };

  const saveDraft = async () => {
    if (draft.length < 3) return;
    setSaving(true);
    try {
      if (property) await store.setProperty({ ...property, zoom });
      if (editing) {
        await store.saveAreaOutline(editing.id, draft);
        router.back();
        return;
      }
      const area = await store.saveArea({ name: name.trim(), type });
      await store.saveAreaOutline(area.id, draft);
      setDraft([]);
      setDrawing(false);
      setNaming(false);
      setName('');
    } finally {
      setSaving(false);
    }
  };

  // Step 1: where is the property?
  if (!start || findingAddress) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: 'Garden map' }} />
        <T variant="title">Map your garden (optional)</T>
        <T variant="small">Find your place on a satellite map, then tap around each garden bed to measure it. The app works out the size for you.</T>
        <Notice tone="info" icon="lock-closed-outline" title="Your address stays on this phone">
          {'Your address and the outlines you draw are saved only on this device (and in backups you make). The search text is sent to OpenStreetMap to find the address, and map images are loaded from Esri. Weather and climate still use your rounded suburb location. You can remove the address at any time.'}
        </Notice>
        <Field label="Street address" value={query} onChangeText={(t) => { setQuery(t); setResults(null); }} placeholder="e.g. 12 Example St, Strathpine" />
        <Button icon="search" label={searching ? 'Searching…' : 'Find address'} onPress={search} loading={searching} disabled={query.trim().length < 4} />
        {results?.map((r) => (
          <Button key={`${r.lat},${r.lon},${r.label}`} variant="secondary" icon="home-outline" label={r.label} onPress={() => void chooseAddress(r)} />
        ))}
        {searchError ? <Notice tone="caution">{searchError}</Notice> : null}
        <T variant="tiny" muted>{ADDRESS_SEARCH_ATTRIBUTION}</T>
        {fallback && !findingAddress ? (
          <Button variant="ghost" icon="map-outline" label="Skip — start from my suburb and move the map" onPress={() => setUseSuburb(true)} />
        ) : null}
        {findingAddress ? <Button variant="ghost" label="Cancel" onPress={() => setFindingAddress(false)} /> : null}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ title: editing ? `Measure ${editing.name}` : 'Garden map' }} />
      <View style={{ flex: 1, minHeight: 200, overflow: 'hidden' }}>
        <GardenMap
          centre={centre}
          zoom={zoom}
          recentreKey={recentreKey}
          outlines={outlines}
          draft={draft}
          drawing={drawing}
          onTap={onTap}
          onZoom={onZoom}
          dom={{ style: { flex: 1 }, scrollEnabled: false }}
        />
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: '45%', borderTopWidth: 1, borderTopColor: p.border }} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        {drawing ? (
          <>
            <T variant="small" style={{ fontWeight: '600' }}>{describe(draft)}</T>
            <Row wrap gap={space.sm}>
              <Button compact variant="secondary" icon="arrow-undo-outline" label="Undo" disabled={!draft.length} onPress={() => setDraft((d) => d.slice(0, -1))} />
              <Button compact variant="secondary" icon="close" label="Clear" disabled={!draft.length} onPress={() => setDraft([])} />
              <Button compact variant="ghost" label="Cancel" onPress={() => { if (editing) router.back(); else { setDrawing(false); setDraft([]); setNaming(false); } }} />
            </Row>
            {naming && !editing ? (
              <Card>
                <Field label="Name this area" value={name} onChangeText={setName} placeholder="e.g. Back vegetable patch" />
                <Row wrap>
                  {MAPPABLE.map((t) => (
                    <Chip key={t} label={AREA_TYPE_LABELS[t]} selected={type === t} onPress={() => setType(t)} />
                  ))}
                </Row>
                <Button icon="checkmark" label="Save area" disabled={!name.trim()} loading={saving} onPress={saveDraft} />
              </Card>
            ) : (
              <Button icon="checkmark" label={editing ? 'Save size' : 'Next'} disabled={draft.length < 3} loading={saving} onPress={() => (editing ? void saveDraft() : setNaming(true))} />
            )}
            <T variant="tiny" muted>Zoom in close for accuracy. Outlines from satellite photos are approximate — trees, shade cloth and photo angle can hide edges.</T>
          </>
        ) : (
          <>
            <T variant="small" muted>{property?.label ?? 'Starting from your suburb — drag and zoom the map to find your garden.'}</T>
            <Row wrap gap={space.sm}>
              <Button compact icon="add" label="Outline a new area" onPress={() => { setDraft([]); setDrawing(true); }} />
              <Button compact variant="ghost" icon="home-outline" label={property ? 'Change address' : 'Find my address'} onPress={() => setFindingAddress(true)} />
            </Row>
            {outlines.length ? <T variant="tiny" muted>{`${outlines.length} area${outlines.length > 1 ? 's' : ''} outlined. To redraw one, open it in My Garden and choose "Measure on map".`}</T> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
