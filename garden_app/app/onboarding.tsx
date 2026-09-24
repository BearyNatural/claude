/**
 * First-run setup of the local Garden Profile. No account is created.
 * Only location is essential; everything else has sensible defaults.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GardenLocation, GardeningGoal, ReminderPreferences, TimeBudget } from '../src/domain/types';
import { requestPermission } from '../src/services/notifications/notificationService';
import { useStore } from '../src/state/hooks';
import { BrandHeader } from '../src/ui/components/garden';
import { Button, Card, Notice, Row, Screen, Stepper, T } from '../src/ui/components/primitives';
import { AreaForm, validateAreaDraft, type AreaDraft } from '../src/ui/forms/areaForm';
import { DEFAULT_REMINDERS, GoalsPicker, LocationPicker, ReminderForm, TimeBudgetPicker, ZonePicker } from '../src/ui/forms/profileForms';
import { space, usePalette } from '../src/ui/theme/theme';

const STEPS = ['welcome', 'location', 'climate', 'household', 'time', 'goals', 'area', 'reminders'] as const;

export default function Onboarding() {
  const store = useStore();
  const p = usePalette();
  const [step, setStep] = useState(0);
  const [location, setLocation] = useState<GardenLocation | null>(null);
  const [household, setHousehold] = useState(2);
  const [time, setTime] = useState<TimeBudget>('1to2');
  const [goals, setGoals] = useState<GardeningGoal[]>(['fresh-veg']);
  const [area, setArea] = useState<AreaDraft>({ name: 'Vegetable bed', type: 'vegetable-bed' });
  const [skipArea, setSkipArea] = useState(false);
  const [reminders, setReminders] = useState<ReminderPreferences>(DEFAULT_REMINDERS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permNote, setPermNote] = useState<string | null>(null);

  const name = STEPS[step];
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const areaErrors = validateAreaDraft(area);

  const finish = async () => {
    if (!location) return;
    setSaving(true);
    setError(null);
    try {
      let rem = reminders;
      if (reminders.enabled) {
        const perm = await requestPermission();
        if (perm === 'denied') {
          rem = { ...reminders, enabled: false };
          setPermNote('Notifications are turned off for this app in your phone settings, so reminders are off for now. Your tasks will still appear on the This Week screen.');
        }
      }
      await store.saveProfile({ location, householdSize: household, timeBudget: time, goals, reminders: rem, onboardingComplete: true });
      if (!skipArea && area.name.trim() && Object.keys(areaErrors).length === 0) await store.saveArea(area);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const canContinue =
    name === 'location' ? !!location : name === 'climate' ? !!(location?.overrideZone ?? location?.suggestedZone) : name === 'area' ? skipArea || Object.keys(areaErrors).length === 0 : true;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }}>
      <Screen>
        <Row style={{ justifyContent: 'space-between' }}>
          <BrandHeader compact />
          <T variant="tiny" muted accessibilityRole="text">{`Step ${step + 1} of ${STEPS.length}`}</T>
        </Row>

        {name === 'welcome' ? (
          <View style={{ gap: space.lg }}>
            <T variant="title">Know what to plant. Know when to plant it.</T>
            <T>
              Sow by Season helps you decide what to plant, when, how much, and what to do in your garden each week — using Australian seasons, your local
              climate and weather, and what you already grow.
            </T>
            <Card>
              <T variant="h3">Your garden stays on this phone</T>
              <T variant="small" muted>
                No account or sign-up. BearyNatural does not keep an online copy of your garden. You can make backups whenever you like.
              </T>
            </Card>
          </View>
        ) : null}

        {name === 'location' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Where is your garden?</T>
            <T variant="small" muted>Your suburb or postcode sets your climate zone, seasons and local weather. Precise GPS isn&apos;t used.</T>
            <LocationPicker value={location} onChange={setLocation} />
          </View>
        ) : null}

        {name === 'climate' && location ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Check your climate</T>
            <ZonePicker location={location} onChange={setLocation} />
          </View>
        ) : null}

        {name === 'household' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">How many people are you hoping to grow food for?</T>
            <T variant="small" muted>This shapes how much we suggest sowing. Different crops scale differently — a household of five needs more carrots, but not more lemon trees.</T>
            <Stepper label="People" value={household} onChange={setHousehold} min={1} max={20} />
          </View>
        ) : null}

        {name === 'time' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Your gardening time</T>
            <TimeBudgetPicker value={time} onChange={setTime} />
          </View>
        ) : null}

        {name === 'goals' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Your goals</T>
            <GoalsPicker value={goals} onChange={setGoals} />
          </View>
        ) : null}

        {name === 'area' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Add a garden area</T>
            <T variant="small" muted>A rough description is plenty — e.g. &quot;Back vegetable patch, about 4 m × 1 m&quot;. You can add more areas later.</T>
            {skipArea ? (
              <Notice tone="info">You can add areas any time from My Garden.</Notice>
            ) : (
              <AreaForm draft={area} onChange={setArea} showAdvanced={false} errors={areaErrors} />
            )}
            <Button variant="ghost" label={skipArea ? 'Add an area now' : 'Skip for now'} onPress={() => setSkipArea((s) => !s)} />
          </View>
        ) : null}

        {name === 'reminders' ? (
          <View style={{ gap: space.md }}>
            <T variant="h2">Gardening days & reminders</T>
            <T variant="small" muted>We group non-urgent jobs into one message for your gardening day instead of lots of separate alerts.</T>
            <ReminderForm value={reminders} onChange={setReminders} />
            {permNote ? <Notice tone="caution">{permNote}</Notice> : null}
          </View>
        ) : null}

        {error ? <Notice tone="danger" title="Couldn't save">{error}</Notice> : null}

        <Row gap={space.md}>
          {step > 0 ? <Button variant="secondary" label="Back" icon="chevron-back" onPress={back} style={{ flex: 1 }} /> : null}
          {step < STEPS.length - 1 ? (
            <Button label={step === 0 ? 'Get started' : 'Continue'} icon="chevron-forward" onPress={next} disabled={!canContinue} style={{ flex: 1 }} />
          ) : (
            <Button label="Start gardening" icon="leaf" onPress={finish} loading={saving} disabled={!location} style={{ flex: 1 }} />
          )}
        </Row>
      </Screen>
    </SafeAreaView>
  );
}
