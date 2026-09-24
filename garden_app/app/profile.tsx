import { router } from 'expo-router';
import React, { useState } from 'react';
import type { GardenLocation, GardeningGoal, TimeBudget } from '../src/domain/types';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Field, Notice, Screen, Section, Stepper, T } from '../src/ui/components/primitives';
import { GoalsPicker, LocationPicker, TimeBudgetPicker, ZonePicker } from '../src/ui/forms/profileForms';

export default function Profile() {
  const { profile, store, data } = useGardenView();
  const [location, setLocation] = useState<GardenLocation | null>(profile?.location ?? null);
  const [household, setHousehold] = useState(profile?.householdSize ?? 2);
  const [time, setTime] = useState<TimeBudget>(profile?.timeBudget ?? '1to2');
  const [goals, setGoals] = useState<GardeningGoal[]>(profile?.goals ?? []);
  const [gardenName, setGardenName] = useState(profile?.gardenName ?? '');
  const [changeLocation, setChangeLocation] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !location) return null;

  const save = async () => {
    try {
      await store.saveProfile({ ...profile, gardenName: gardenName.trim() || undefined, location, householdSize: household, timeBudget: time, goals });
      setSaved(true);
      setTimeout(() => router.back(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <T variant="small" muted>Your Garden Profile is stored only on this device. It personalises planting times, quantities and weekly jobs.</T>
      <Field label="Garden name (optional)" value={gardenName} onChangeText={setGardenName} placeholder="e.g. Home garden" />
      <Section title="Location">
        {changeLocation ? (
          <LocationPicker value={location} onChange={(l) => { setLocation(l); setChangeLocation(false); }} />
        ) : (
          <Card>
            <T variant="h3">{[location.suburb, location.state, location.postcode].filter(Boolean).join(' ') || 'Set manually'}</T>
            <T variant="tiny" muted>{`Timezone ${location.timezone}${location.approxLatitude !== undefined ? ` · approx. ${location.approxLatitude}, ${location.approxLongitude}` : ''}`}</T>
            <Button compact variant="ghost" icon="location-outline" label="Change location" onPress={() => setChangeLocation(true)} />
          </Card>
        )}
      </Section>
      <ZonePicker location={location} onChange={setLocation} />
      <Section title="Household">
        <Stepper label="People you hope to grow food for" value={household} onChange={setHousehold} min={1} max={20} />
      </Section>
      <TimeBudgetPicker value={time} onChange={setTime} />
      <GoalsPicker value={goals} onChange={setGoals} />
      <Section title="Weather">
        <Card>
          <T variant="small">{data.settings.weatherEnabled ? 'Live weather is on. Your approximate location (about 1 km) is sent to Open-Meteo to get a forecast.' : 'Live weather is off. Advice uses seasonal information only.'}</T>
          <Button compact variant="secondary" label={data.settings.weatherEnabled ? 'Turn weather off' : 'Turn weather on'} onPress={async () => { await store.saveSettings({ weatherEnabled: !data.settings.weatherEnabled }); if (!data.settings.weatherEnabled) void store.refreshWeather(true); }} />
        </Card>
      </Section>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {saved ? <Notice tone="good">Saved.</Notice> : null}
      <Button label="Save profile" icon="checkmark" onPress={save} />
    </Screen>
  );
}
