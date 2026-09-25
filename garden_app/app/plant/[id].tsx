import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { COMPANIONS } from '../../src/data/companions';
import { SOURCES } from '../../src/data/sources';
import { THREE_SISTERS } from '../../src/data/systems';
import { CLIMATE_ZONES, ZONE_IDS } from '../../src/domain/climate';
import { companionsFor, EVIDENCE_LABELS, REASON_LABELS } from '../../src/domain/companions';
import type { PlantRecord } from '../../src/domain/plantTypes';
import { estimateQuantity, formatRange, productionLevelFromGoals } from '../../src/domain/production';
import { recommendPlant } from '../../src/domain/recommend';
import { isSuccessionSuited } from '../../src/domain/succession';
import type { Range } from '../../src/domain/types';
import { describeMonths, normaliseMonths } from '../../src/domain/windows';
import { catalogue, getPlant } from '../../src/state/gardenStore';
import { useGardenView } from '../../src/state/hooks';
import { CategoryBadge, InfoTip, MonthStrip, ReasonList } from '../../src/ui/components/garden';
import { Badge, Button, Card, Divider, EmptyState, Row, Screen, Section, T, type Tone } from '../../src/ui/components/primitives';
import { space } from '../../src/ui/theme/theme';

const r = (x?: Range, unit = '') => (x ? (x[0] === x[1] ? `${x[0]}${unit}` : `${x[0]}–${x[1]}${unit}`) : 'Not recorded');

function Fact({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }} align="flex-start">
      <Row gap={2} style={{ flex: 1 }}>
        <T variant="small" muted>{label}</T>
        {tip ? <InfoTip termId={tip} /> : null}
      </Row>
      <T variant="small" style={{ flex: 1.2, textAlign: 'right' }}>{value}</T>
    </Row>
  );
}

const EVIDENCE_TONE: Record<string, Tone> = { established: 'good', plausible: 'info', traditional: 'neutral' };

function SourcesList({ plant }: { plant: PlantRecord }) {
  const ids = new Set<string>();
  Object.values(plant.windows).forEach((w) => w && ids.add(w.sourceId));
  [plant.germination?.sourceIds, plant.timing?.sourceIds, plant.climate.sourceIds, plant.site.sourceIds, plant.spacing?.sourceIds, plant.feeding?.sourceIds]
    .flat()
    .forEach((i) => i && ids.add(i));
  ids.add(plant.production.sourceId);
  return (
    <View style={{ gap: space.sm }}>
      {[...ids].map((id) => {
        const s = SOURCES[id];
        if (!s) return null;
        return (
          <View key={id} style={{ gap: 2 }}>
            <T variant="small" style={{ fontWeight: '600' }}>{s.title}</T>
            <T variant="tiny" muted>{`${s.publisher} · consulted ${s.accessed}`}</T>
            {s.url ? <Button compact variant="ghost" icon="open-outline" label="Open source" onPress={() => Linking.openURL(s.url!)} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export default function PlantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plant = getPlant(String(id));
  const { recCtx, zone, today, profile, store, data } = useGardenView();
  const [allZones, setAllZones] = useState(false);
  const rec = useMemo(() => (plant ? recommendPlant(plant, recCtx) : null), [plant, recCtx]);
  if (!plant || !rec) return <EmptyState title="Plant not found" body="It may have been removed from the catalogue." />;

  const qty = estimateQuantity(plant, { householdSize: profile?.householdSize ?? 1, level: productionLevelFromGoals(profile?.goals ?? []), timeBudget: profile?.timeBudget ?? '1to2' });
  const companions = companionsFor(plant, catalogue.all, COMPANIONS);
  const wished = data.wishlist.some((w) => w.plantId === plant.id);
  const hidden = data.settings.hiddenPlantIds.includes(plant.id);
  const zw = zone ? plant.windows[zone] : undefined;
  const harvest = zone ? plant.timing?.harvestMonths?.[zone] : undefined;
  const inThreeSisters = THREE_SISTERS.members.some((m) => m.plantId === plant.id);

  return (
    <Screen>
      <Stack.Screen options={{ title: plant.commonName }} />
      <View style={{ gap: 4 }}>
        <T variant="title">{plant.commonName}</T>
        {plant.botanicalName ? <T variant="small" muted style={{ fontStyle: 'italic' }}>{`${plant.botanicalName}${plant.family && plant.family !== 'Other' ? ` · ${plant.family}` : plant.familyName ? ` · ${plant.familyName}` : ''}`}</T> : null}
        <Row wrap gap={6}>
          {plant.categories.map((c) => (
            <Badge key={c} label={c.replace('-', ' ')} tone={c === 'native' ? 'earth' : 'neutral'} />
          ))}
          <Badge label={plant.lifecycle} />
        </Row>
      </View>
      <T>{plant.summary}</T>
      {plant.origin === 'yours' ? (
        <Card tone="info">
          <T variant="small">A plant you added. Its details are the ones you entered, and it&apos;s kept in your backups.</T>
          {(() => {
            const own = data.customPlants.find((c) => c.id === plant.id);
            if (!own?.share) return null;
            return <T variant="tiny" muted>{own.share.status === 'shared' ? 'Shared with the plant list — it will be checked before being added for everyone.' : 'Waiting to be shared with the plant list (sends when online).'}</T>;
          })()}
          <Button compact variant="secondary" icon="create-outline" label="Edit your plant" onPress={() => router.push({ pathname: '/plant/custom', params: { id: plant.id } })} />
        </Card>
      ) : plant.origin === 'update' ? (
        <Badge tone="info" icon="cloud-download-outline" label="From a plant list update" />
      ) : null}

      <Card>
        <Row gap={8}>
          <CategoryBadge category={rec.category} />
          <T variant="h3" style={{ flex: 1 }}>{rec.headline}</T>
        </Row>
        <ReasonList reasons={rec.reasons} />
      </Card>

      <Row wrap gap={space.sm}>
        <Button icon="add" label="Add to garden" onPress={() => router.push({ pathname: '/planting/new', params: { plantId: plant.id, method: rec.suggestedMethod } })} />
        {isSuccessionSuited(plant) ? <Button variant="secondary" icon="repeat" label="Plan succession" onPress={() => router.push({ pathname: '/succession/new', params: { plantId: plant.id } })} /> : null}
        <Button variant="secondary" icon={wished ? 'heart' : 'heart-outline'} label={wished ? 'On wish list' : 'Add to wish list'} onPress={() => void store.toggleWish(plant.id)} />
      </Row>

      <Section title="When to plant" subtitle={zone ? `${CLIMATE_ZONES[zone].name} areas` : undefined}>
        <Card>
          {zw ? (
            <>
              {zw.sow ? <MonthStrip label={`Sow seed: ${describeMonths(zw.sow)}`} months={zw.sow} today={today} /> : null}
              {zw.plant ? <MonthStrip label={`Plant: ${describeMonths(zw.plant)}`} months={zw.plant} today={today} /> : null}
              {harvest ? <MonthStrip label={`Harvest season: ${describeMonths(harvest)}`} months={harvest} today={today} tone="earth" /> : null}
              <T variant="tiny" muted>{`Source: ${SOURCES[zw.sourceId]?.publisher ?? zw.sourceId}${zw.note ? ` — ${zw.note}` : ''}`}</T>
            </>
          ) : (
            <T variant="small" muted>No sourced planting window for your zone yet. We&apos;d rather say so than guess — local nurseries and seed packets are a good guide.</T>
          )}
          <Button compact variant="ghost" label={allZones ? 'Hide other climates' : 'Compare other climates'} onPress={() => setAllZones((a) => !a)} />
          {allZones
            ? ZONE_IDS.filter((z) => z !== zone).map((z) => {
                const w = plant.windows[z];
                const ms = normaliseMonths([...(w?.sow ?? []), ...(w?.plant ?? [])]);
                return <MonthStrip key={z} label={`${CLIMATE_ZONES[z].name}: ${w ? describeMonths(ms) : 'not recorded'}`} months={ms} tone="info" />;
              })
            : null}
        </Card>
      </Section>

      {plant.categories.some((c) => ['vegetable', 'herb', 'fruit'].includes(c)) ? (
        <Section title="How much to grow">
          <Card>
            <T variant="h3">{`${isSuccessionSuited(plant) ? 'Per sowing: ' : ''}${formatRange(qty.range, qty.unit)}`}</T>
            <T variant="small" muted>{qty.explanation}</T>
            {plant.production.successionIntervalDays ? (
              <T variant="small">{`Succession: a new batch about every ${r(plant.production.successionIntervalDays, ' days')} while the window is open.`}</T>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Growing needs">
        <Card>
          <Fact label="Sun" value={`${plant.site.sun.replace('-', ' ')}${plant.site.minSunHours ? ` (${plant.site.minSunHours}+ h)` : ''}`} />
          <Fact label="Water" value={plant.site.water} />
          <Fact label="Soil pH" value={r(plant.site.soilPh)} tip="soil-ph" />
          <Fact label="Drainage" value={plant.site.drainage?.replace('-', ' ') ?? 'Not recorded'} />
          <Fact label="Frost" value={plant.climate.frost === 'tender' ? 'Frost-tender' : plant.climate.frost === 'hardy' ? 'Frost-hardy' : plant.climate.frost === 'half-hardy' ? 'Tolerates light frost' : 'Not recorded'} tip="frost-tender" />
          <Fact label="Heat" value={plant.climate.heat === 'unknown' ? 'Not recorded' : `${plant.climate.heat} tolerance${plant.climate.boltsInHeat ? ', bolts in heat' : ''}`} tip={plant.climate.boltsInHeat ? 'bolting' : undefined} />
          <Fact label="Support" value={plant.support === 'none' ? 'None needed' : plant.support} />
          <Fact label="Pots" value={plant.container.suitable === true ? `Yes${plant.container.minVolumeL ? ` (≥ ${plant.container.minVolumeL} L)` : ''}` : plant.container.suitable === false ? 'Not well suited' : 'Not recorded'} />
          {plant.container.notes ? <T variant="tiny" muted>{plant.container.notes}</T> : null}
          {plant.site.soilNotes ? <T variant="small">{plant.site.soilNotes}</T> : null}
          {plant.feeding ? <T variant="small">{`Feeding: ${plant.feeding.level}${plant.feeding.notes ? ` — ${plant.feeding.notes}` : ''}`}</T> : null}
        </Card>
      </Section>

      {plant.amendments?.length ? (
        <Section title="Soil preparation">
          <Card>
            {plant.amendments.map((a, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Row gap={6}>
                  <Badge tone={a.kind === 'add' ? 'good' : 'caution'} icon={a.kind === 'add' ? 'add-circle-outline' : 'remove-circle-outline'} label={a.kind === 'add' ? 'Do' : 'Avoid'} />
                  <T variant="small" style={{ flex: 1, fontWeight: '600' }}>{a.advice}</T>
                </Row>
                <T variant="tiny" muted>{`Why: ${a.reason}`}</T>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Timing & size" subtitle="Typical figures — varieties and weather vary.">
        <Card>
          <Fact label="Germination" value={r(plant.germination?.days, ' days')} tip="germination" />
          <Fact label="Soil temp to germinate" value={plant.germination?.soilTempMinC !== undefined ? `min ~${plant.germination.soilTempMinC}°C, best ${r(plant.germination.soilTempOptimumC, '°C')}` : 'Not recorded'} />
          <Fact label="Ready to transplant" value={r(plant.timing?.daysToTransplant, ' days')} tip="transplant" />
          <Fact label="First flowers" value={r(plant.timing?.daysToFlower, ' days from sowing')} />
          <Fact label="To harvest" value={r(plant.timing?.daysToMaturity, ' days from sowing')} />
          {plant.timing?.yearsToFirstCrop ? <Fact label="First crop" value={r(plant.timing.yearsToFirstCrop, ' years')} /> : null}
          <Divider />
          <Fact label="Plant spacing" value={r(plant.spacing?.plantCm, ' cm')} />
          <Fact label="Row spacing" value={r(plant.spacing?.rowCm, ' cm')} />
          <Fact label="Mature height" value={r(plant.spacing?.matureHeightCm, ' cm')} />
          <Fact label="Mature width" value={r(plant.spacing?.matureWidthCm, ' cm')} />
          <Fact label="Sowing depth" value={r(plant.spacing?.sowingDepthMm, ' mm')} />
        </Card>
      </Section>

      {companions.length ? (
        <Section title="Companions" subtitle="Each pairing shows why, and how well supported it is.">
          <Card>
            {companions.map((c) => (
              <View key={`${c.relation.id}-${c.other.id}`} style={{ gap: 4, paddingVertical: 4 }}>
                <Row gap={6} wrap>
                  <T variant="small" style={{ fontWeight: '600' }}>{c.other.commonName}</T>
                  <Badge tone={c.relation.effect === 'beneficial' ? 'good' : 'caution'} icon={c.relation.effect === 'beneficial' ? 'thumbs-up-outline' : 'close-circle-outline'} label={c.relation.effect === 'beneficial' ? 'Good together' : 'Keep apart'} />
                  <Badge tone={EVIDENCE_TONE[c.relation.evidence]} label={EVIDENCE_LABELS[c.relation.evidence]} />
                </Row>
                <T variant="tiny" muted>{c.relation.reasons.map((x) => REASON_LABELS[x]).join(' · ')}</T>
                <T variant="small">{c.relation.note}</T>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {inThreeSisters ? (
        <Card onPress={() => router.push('/three-sisters')} accessibilityLabel="Part of the Three Sisters planting system">
          <T variant="h3">Part of the Three Sisters system</T>
          <T variant="small" muted>Grow corn, climbing beans and pumpkin together, in the right order.</T>
        </Card>
      ) : null}

      {plant.pruning || plant.problems?.length ? (
        <Section title="Care notes">
          <Card>
            {plant.pruning ? <T variant="small">{`Pruning: ${plant.pruning}`}</T> : null}
            {plant.problems?.length ? <T variant="small">{`Common problems: ${plant.problems.join('; ')}.`}</T> : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Where this information comes from">
        <Card>
          <Badge tone={plant.review.status === 'draft' ? 'caution' : 'info'} icon="document-text-outline" label={plant.review.status === 'draft' ? 'Draft — needs review' : plant.review.status === 'source-checked' ? 'Checked against sources' : 'Expert reviewed'} />
          {plant.review.notes ? <T variant="tiny" muted>{plant.review.notes}</T> : null}
          <SourcesList plant={plant} />
        </Card>
      </Section>

      <Button
        variant="ghost"
        icon={hidden ? 'eye-outline' : 'eye-off-outline'}
        label={hidden ? 'Show in recommendations again' : "Don't recommend this plant"}
        onPress={() => void store.saveSettings({ hiddenPlantIds: hidden ? data.settings.hiddenPlantIds.filter((x) => x !== plant.id) : [...data.settings.hiddenPlantIds, plant.id] })}
      />
    </Screen>
  );
}
