import React from 'react';
import { Linking } from 'react-native';
import { CATALOGUE_VERSION, PLANTS } from '../src/data/plants';
import { SOURCES } from '../src/data/sources';
import { ENV } from '../src/services/env';
import { BrandHeader } from '../src/ui/components/garden';
import { Badge, Button, Card, Notice, Row, Screen, Section, T } from '../src/ui/components/primitives';

export default function About() {
  const counts = {
    checked: PLANTS.filter((p) => p.review.status === 'source-checked').length,
    draft: PLANTS.filter((p) => p.review.status === 'draft').length,
    expert: PLANTS.filter((p) => p.review.status === 'expert-reviewed').length,
  };
  return (
    <Screen>
      <BrandHeader />
      <T variant="small" muted>{`Version ${ENV.appVersion} · plant data ${CATALOGUE_VERSION} · ${PLANTS.length} plants`}</T>
      <Notice tone="caution" title="Gardening is biological — advice is a guide">
        Planting windows, quantities and dates are typical ranges from Australian references and planning estimates. Local conditions, varieties, weather and pests all change results. You can always plant outside the suggestions.
      </Notice>
      <Section title="Plant data quality">
        <Card>
          <Row wrap gap={6}>
            <Badge tone="info" label={`${counts.checked} checked against sources`} />
            <Badge tone="caution" label={`${counts.draft} draft`} />
            <Badge tone="good" label={`${counts.expert} expert reviewed`} />
          </Row>
          <T variant="small">Each plant shows where its information comes from. Where no reliable source was found, the app shows &quot;not recorded&quot; rather than inventing a number. Values marked as general knowledge or BearyNatural heuristics are awaiting horticultural review.</T>
        </Card>
      </Section>
      <Section title="Sources">
        {Object.values(SOURCES).map((s) => (
          <Card key={s.id}>
            <T variant="h3">{s.title}</T>
            <T variant="tiny" muted>{`${s.publisher} · consulted ${s.accessed}`}</T>
            {s.notes ? <T variant="small">{s.notes}</T> : null}
            {s.url ? <Button compact variant="ghost" icon="open-outline" label="Open" onPress={() => Linking.openURL(s.url!)} /> : null}
          </Card>
        ))}
      </Section>
      <Section title="Weather">
        <Card>
          <T variant="small">Weather data by Open-Meteo.com (CC BY 4.0), which combines forecast models from national weather services. Soil temperatures are model estimates, not measurements.</T>
          <Button compact variant="ghost" icon="open-outline" label="open-meteo.com" onPress={() => Linking.openURL('https://open-meteo.com/')} />
        </Card>
      </Section>
      <Section title="Places and postcodes">
        <Card>
          <T variant="small">Suburb and postcode search works offline using the GeoNames Australian postal code list (CC BY 4.0). Coordinates are approximate area centres, used only for weather and climate suggestions.</T>
          <Button compact variant="ghost" icon="open-outline" label="geonames.org" onPress={() => Linking.openURL('https://www.geonames.org/')} />
        </Card>
      </Section>
      <Section title="Garden map">
        <Card>
          <T variant="small">Satellite imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Address search © OpenStreetMap contributors (Photon by Komoot, Nominatim; ODbL). Map display by Leaflet. Sizes measured from satellite photos are approximate.</T>
          <Button compact variant="ghost" icon="open-outline" label="openstreetmap.org/copyright" onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} />
        </Card>
      </Section>
    </Screen>
  );
}
