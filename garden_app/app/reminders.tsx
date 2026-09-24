import React, { useEffect, useMemo, useState } from 'react';
import { hourInTimeZone, formatDay } from '../src/domain/dates';
import { planReminders } from '../src/domain/reminders';
import type { ReminderPreferences } from '../src/domain/types';
import { getPermission, notificationsSupported, requestPermission, type PermissionState } from '../src/services/notifications/notificationService';
import { useGardenView } from '../src/state/hooks';
import { Button, Card, Notice, Screen, Section, T } from '../src/ui/components/primitives';
import { ReminderForm } from '../src/ui/forms/profileForms';

export default function Reminders() {
  const { profile, store, tasks, today, state } = useGardenView();
  const [prefs, setPrefs] = useState<ReminderPreferences>(profile!.reminders);
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getPermission().then(setPerm);
  }, []);

  const preview = useMemo(() => {
    if (!profile) return [];
    const h = hourInTimeZone(profile.location.timezone, state.now);
    return planReminders({ tasks, prefs, timeBudget: profile.timeBudget, today, nowTime: `${String(h).padStart(2, '0')}:00`, horizonDays: 7 });
  }, [tasks, prefs, profile, today, state.now]);

  if (!profile) return null;
  const save = async () => {
    let p = prefs;
    if (prefs.enabled && perm !== 'granted') {
      const r = await requestPermission();
      setPerm(r);
      if (r !== 'granted') p = { ...prefs, enabled: false };
    }
    await store.saveProfile({ ...profile, reminders: p });
    setPrefs(p);
    setSaved(true);
  };

  return (
    <Screen>
      {!notificationsSupported() ? <Notice tone="info">Notifications aren&apos;t available in the web preview. Your preferences are still saved and used to plan your week.</Notice> : null}
      {perm === 'denied' ? <Notice tone="caution" title="Notifications are blocked">Allow notifications for Sow by Season in your phone&apos;s Settings to receive reminders. Everything still appears on the This Week screen.</Notice> : null}
      <ReminderForm value={prefs} onChange={(p) => { setPrefs(p); setSaved(false); }} />
      <Button label="Save" icon="checkmark" onPress={save} />
      {saved ? <Notice tone="good">Saved. Reminders are rescheduled automatically.</Notice> : null}
      <Section title="Coming reminders" subtitle="Based on your garden right now.">
        {preview.length ? (
          preview.map((r) => (
            <Card key={r.id}>
              <T variant="small" muted>{`${formatDay(r.date, today)} at ${r.time}${r.kind === 'urgent' ? ' · urgent' : ''}`}</T>
              <T variant="h3">{r.title}</T>
              <T variant="small">{r.body}</T>
            </Card>
          ))
        ) : (
          <T variant="small" muted>{prefs.enabled ? 'Nothing to remind you about in the next week.' : 'Reminders are off.'}</T>
        )}
      </Section>
      <Notice tone="neutral" title="How reminders work">
        Reminders are scheduled on this phone whenever you open the app. Phones don&apos;t let apps run reliably in the background, so if the forecast changes after you last opened Sow by Season (for example, a new frost warning), the reminder may not reflect it until you open the app again.
      </Notice>
    </Screen>
  );
}
