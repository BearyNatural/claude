import { router } from 'expo-router';
import React, { useState } from 'react';
import { cancelAllReminders } from '../src/services/notifications/notificationService';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { space } from '../src/ui/theme/theme';

const POINTS: { title: string; body: string }[] = [
  { title: 'Your garden is stored on this device', body: 'Your Garden Profile, garden areas, plantings, journal, wish list, plans and settings are saved in the app\'s storage on this phone (or in this browser, for the web preview).' },
  { title: 'No BearyNatural account', body: 'There is no sign-up and BearyNatural does not run an online garden database. We don\'t receive your garden data.' },
  { title: 'Location is approximate and only used for climate and weather', body: 'We use your suburb or postcode to suggest a climate zone and to fetch local weather. Coordinates are rounded to about 1 km. The app never asks for GPS or background location.' },
  { title: 'What leaves your phone', body: 'When live weather is on, your approximate coordinates and timezone are sent to Open-Meteo (open-meteo.com) to get a forecast. If you use "Search more places online", your search text is sent to Open-Meteo\'s place search. These services receive the information needed to answer the request, like any website does (including your IP address). Nothing else is sent.' },
  { title: 'Reminders are local', body: 'Reminders are scheduled by your phone\'s own notification system. No push-notification server is involved.' },
  { title: 'Clearing app data can remove your garden', body: 'Uninstalling the app, clearing its data, or losing your phone can delete your records. Make backups if you want extra protection.' },
  { title: 'Backups go where you choose', body: 'A backup is a file you save using your phone\'s normal file options — for example on the device, iCloud Drive, Google Drive, OneDrive or Dropbox. The app doesn\'t upload it anywhere by itself.' },
];

export default function Privacy() {
  const { store } = useGardenView();
  const [confirm, setConfirm] = useState(false);
  return (
    <Screen>
      <T variant="title">Privacy & your data</T>
      {POINTS.map((p) => (
        <Card key={p.title}>
          <T variant="h3">{p.title}</T>
          <T variant="small">{p.body}</T>
        </Card>
      ))}
      <Section title="Your controls">
        <Card>
          <Button variant="secondary" icon="cloud-upload-outline" label="Back up my garden" onPress={() => router.push('/backup')} />
          <Button variant="secondary" icon="cloud-offline-outline" label="Weather settings" onPress={() => router.push('/profile')} />
        </Card>
        {confirm ? (
          <Card tone="danger">
            <T variant="h3">Delete everything?</T>
            <T variant="small">All garden records, settings and cached weather will be permanently removed from this device. This can&apos;t be undone unless you have a backup file.</T>
            <Row gap={space.sm} wrap>
              <Button variant="danger" icon="trash" label="Delete all my data" onPress={async () => { await cancelAllReminders().catch(() => undefined); await store.deleteAllData(); router.replace('/onboarding'); }} />
              <Button variant="secondary" label="Cancel" onPress={() => setConfirm(false)} />
            </Row>
          </Card>
        ) : (
          <Button variant="ghost" icon="trash-outline" label="Delete all data from this device" onPress={() => setConfirm(true)} />
        )}
      </Section>
    </Screen>
  );
}
