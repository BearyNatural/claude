import { router } from 'expo-router';
import React, { useState } from 'react';
import { cancelAllReminders } from '../src/services/notifications/notificationService';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Row, Screen, Section, T } from '../src/ui/components/primitives';
import { space } from '../src/ui/theme/theme';

const POINTS: { title: string; body: string }[] = [
  { title: 'Your garden is stored on this device', body: 'Your Garden Profile, garden areas, plantings, photos, journal, wish list, plans and settings are saved in the app\'s storage on this phone (or in this browser, for the browser version).' },
  { title: 'No BearyNatural account', body: 'There is no sign-up and BearyNatural does not run an online garden database. We don\'t receive your garden data.' },
  { title: 'Location is approximate and only used for climate and weather', body: 'We use your suburb or postcode to suggest a climate zone and to fetch local weather. Coordinates are rounded to about 1 km. The app never asks for GPS or background location. If you turn on weather alerts when the app is closed, the same rounded location is used for those checks.' },
  { title: 'Your street address is optional and stays on this device', body: 'Only if you use the optional garden map: the address you choose and the garden outlines you trace are saved on this device (and in backups you make), never on a server. Weather and climate keep using your rounded suburb location. You can remove the address and outlines at any time from Garden Profile.' },
  { title: 'What leaves your device', body: 'When live weather is on, your approximate coordinates and timezone are sent to Open-Meteo (open-meteo.com) to get a forecast. If you use "Search more places online", your search text is sent to Open-Meteo\'s place search. If you use the optional garden map, the address you type is sent to an OpenStreetMap address search (Photon by Komoot, or Nominatim as a fallback) when you press Find address, and satellite map images for the area on screen are loaded from Esri. About once a day the app downloads the latest plant list from GitHub and checks whether a new version of the app is available (downloads only — nothing about you or your garden is sent). If you look up a botanical name for a plant you add, that name is sent to the Atlas of Living Australia. If you share a plant you added, its details go to the Sow by Season plant list inbox. If you turn on automatic backup, backups are written to the folder you chose. These services receive the information needed to answer the request, like any website does (including your IP address). Nothing else is sent.' },
  { title: 'Plant photos stay on this device', body: 'Photos you add to plants are shrunk and kept in the app\'s own storage on this device — not uploaded anywhere, and not added to your phone\'s gallery. They go into a backup only if you choose "Include photos" when backing up. Deleting a photo or a planting deletes its photo files.' },
  { title: 'Sharing plants you add is optional', body: 'When you add a plant that isn\'t listed, you can choose to share it (ticked by default; untick to keep it to yourself). Shared plants may be used to expand the Sow by Season plant list for everyone, after being checked against reliable sources. Only the plant\'s details, your notes about it and your climate zone (e.g. "subtropical") are sent — never photos, your location, address, garden or anything about you. Keep personal details out of plant notes.' },
  { title: 'Using the app and the browser', body: 'The phone app and the browser version each keep their own copy of your garden on that device. To use the same garden in both, or to move to a new phone, back up to your own cloud storage (Google Drive, OneDrive or iCloud Drive) and restore the file there. On Android you can turn on automatic backup to a folder you choose.' },
  { title: 'Reminders are local', body: 'Reminders and weather alerts are created by the app on your phone and shown by your phone\'s own notification system. No push-notification server is involved.' },
  { title: 'Clearing app data can remove your garden', body: 'Uninstalling the app, clearing its data, or losing your device can delete your records. In a browser, clearing site data can too — and Safari may remove a website\'s data if you haven\'t visited it for about a week, unless you added it to your Home Screen. Keep a backup in your cloud storage.' },
  { title: 'Backups go where you choose', body: 'A backup is a file you save using your device\'s normal file options — for example on the device, iCloud Drive, Google Drive, OneDrive or Dropbox. If you turn on automatic backup (Android), the app keeps a backup file up to date in the folder you chose — for example in Google Drive. Otherwise it doesn\'t save a backup anywhere by itself.' },
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
