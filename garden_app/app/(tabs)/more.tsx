import { router } from 'expo-router';
import React from 'react';
import { CLIMATE_ZONES } from '../../src/domain/climate';
import { describeLocation } from '../../src/domain/location';
import { useGardenView } from '../../src/state/hooks';
import { BrandHeader } from '../../src/ui/components/garden';
import { Card, ListRow, Screen, Section, T } from '../../src/ui/components/primitives';

export default function More() {
  const { profile, zone, data, gardens, garden } = useGardenView();
  return (
    <Screen>
      <BrandHeader />
      <T variant="small" muted>Know what to plant. Know when to plant it.</T>
      <Section title="Your garden">
        <Card>
          <ListRow icon="person-circle-outline" title="Garden Profile" subtitle={`${describeLocation(profile?.location)}${zone ? ` · ${CLIMATE_ZONES[zone].name}` : ''} · ${profile?.householdSize ?? 1} people`} onPress={() => router.push('/profile')} />
          <ListRow icon="leaf-outline" title="Gardens" subtitle={gardens.length > 1 ? `${gardens.length} gardens · showing ${garden?.name}` : 'Add another garden, e.g. a community plot'} onPress={() => router.push('/gardens')} />
          <ListRow icon="notifications-outline" title="Reminders & gardening days" subtitle={profile?.reminders.enabled ? 'On' : 'Off'} onPress={() => router.push('/reminders')} />
          <ListRow icon="calendar-outline" title="Seasonal calendar" onPress={() => router.push('/calendar')} />
          <ListRow icon="heart-outline" title="Wish list" subtitle={`${data.wishlist.length} plants`} onPress={() => router.push('/wishlist')} />
          <ListRow icon="create-outline" title="Garden journal" onPress={() => router.push('/journal')} />
        </Card>
      </Section>
      <Section title="Your data">
        <Card>
          <ListRow icon="cloud-upload-outline" title="Backup & restore" subtitle={data.settings.lastBackupAt ? `Last backup ${data.settings.lastBackupAt.slice(0, 10)}` : 'No backup yet'} onPress={() => router.push('/backup')} />
          <ListRow icon="shield-checkmark-outline" title="Privacy & your data" onPress={() => router.push('/privacy')} />
        </Card>
      </Section>
      <Section title="Learn">
        <Card>
          <ListRow icon="book-outline" title="Gardening words explained" onPress={() => router.push('/glossary')} />
          <ListRow icon="library-outline" title="About, sources & data quality" onPress={() => router.push('/about')} />
        </Card>
      </Section>
    </Screen>
  );
}
