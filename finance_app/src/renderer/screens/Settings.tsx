import { useState } from 'react';
import { api, IS_WEB, useAction, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, ErrorText, Loading, NumberField, Page, SelectField, Tabs, TextField } from '../components/ui';
import type { AppSettings, ReminderType } from '../../shared/types';

const REMINDER_LABEL: Record<ReminderType, string> = {
  bills: 'Bills due', termDeposits: 'Term deposits maturing', taxReview: 'Tax time (July–October)', insurance: 'Insurance renewals', goals: 'Monthly goal check-in',
  backup: 'Backup reminder (every N days)', mortgage: 'Mortgage repayments', annualExpense: 'Annual expenses (sinking funds)',
};

function useSettingsUpdate() {
  const { setSettings, toast } = useApp();
  return async (patch: Partial<AppSettings>) => {
    try {
      setSettings(await api('settings.update', patch));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
}

function Preferences({ s }: { s: AppSettings }) {
  const update = useSettingsUpdate();
  const toggle = (k: 'week' | 'fortnight' | 'month' | 'quarter') => update({ analysisPeriods: s.analysisPeriods.includes(k) ? s.analysisPeriods.filter((x) => x !== k) : [...s.analysisPeriods, k] });
  return (
    <div className="stack-lg">
      <Card title="How you look at money" sub="Use any mix — for example weekly spending, monthly budgets and quarterly tax">
        <div className="row">{(['week', 'fortnight', 'month', 'quarter'] as const).map((k) => <Checkbox key={k} label={{ week: 'Weekly', fortnight: 'Fortnightly', month: 'Monthly', quarter: 'Quarterly' }[k]} checked={s.analysisPeriods.includes(k)} onChange={() => toggle(k)} />)}</div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <DateField label="Fortnights start on (e.g. a payday)" value={s.fortnightAnchor} onChange={(v) => update({ fortnightAnchor: v })} />
          <SelectField label="Weeks start on" value={String(s.weekStartsOn)} onChange={(v) => update({ weekStartsOn: Number(v) as 1 | 7 })} options={[{ value: '1', label: 'Monday' }, { value: '7', label: 'Sunday' }]} />
        </div>
      </Card>
      <Card title="Appearance and accessibility">
        <div className="form-grid">
          <SelectField label="Theme" value={s.theme} onChange={(v) => update({ theme: v })} options={[{ value: 'system', label: 'Match my computer' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          <SelectField label="Text size" value={String(s.textScale)} onChange={(v) => update({ textScale: Number(v) })} options={[{ value: '0.9', label: 'Smaller' }, { value: '1', label: 'Standard' }, { value: '1.15', label: 'Larger' }, { value: '1.3', label: 'Largest' }]} />
        </div>
        <div className="stack" style={{ marginTop: 10 }}>
          <Checkbox label="High contrast" checked={s.highContrast} onChange={(v) => update({ highContrast: v })} />
          <Checkbox label="Hide amounts when Geranium opens (privacy mode)" checked={s.privacyModeDefault} onChange={(v) => update({ privacyModeDefault: v })} hint="Toggle any time with the eye button or Ctrl+Shift+H. Stored data is not changed." />
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Keyboard: Ctrl+K search · Ctrl+Shift+H hide amounts · Ctrl+L lock · Tab/Shift+Tab move · Enter opens a selected row · Esc closes dialogs.</p>
      </Card>
      <Card title="Tax profile">
        <div className="stack">
          <Checkbox label="Registered for GST" checked={s.gstRegistered} onChange={(v) => update({ gstRegistered: v })} />
          <Checkbox label="HELP or other study/training loan" checked={s.hasStudyLoan} onChange={(v) => update({ hasStudyLoan: v })} />
          <Checkbox label="Exempt from the Medicare levy" checked={s.medicareExempt} onChange={(v) => update({ medicareExempt: v })} />
        </div>
      </Card>
    </div>
  );
}

function Security() {
  const { status, setStatus, settings, toast } = useApp();
  const update = useSettingsUpdate();
  const log = useApi('app.networkLog', undefined, []);
  const [kind, setKind] = useState<'password' | 'pin'>('password');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [current, setCurrent] = useState('');
  const setPw = useAction(async () => {
    if (secret !== confirmSecret) throw new Error('The two entries do not match.');
    setStatus(await api('security.setPassword', { secret, kind }));
    setSecret(''); setConfirmSecret('');
    toast(`${kind === 'pin' ? 'PIN' : 'Password'} set. Geranium will ask for it each time it opens.`, 'success');
  });
  const removePw = useAction(async () => { setStatus(await api('security.removePassword', { secret: current })); setCurrent(''); toast('Password removed. Your computer login now protects the key.', 'success'); });
  if (!status || !settings) return <Loading />;
  const a = settings.autoLock;
  return (
    <div className="stack-lg">
      <Card title="Where your data is" sub="Nothing is stored anywhere else unless you export or back it up">
        <dl className="kv">
          {IS_WEB ? <><dt>Stored in</dt><dd>This browser’s storage (IndexedDB) on this device, encrypted. Clearing this site’s data in the browser deletes it, and Safari may clear it after 7 days without a visit unless Geranium is added to the Home Screen — keep an encrypted backup.</dd></> : <><dt>Data folder</dt><dd><code>{status.dataFolder}</code> <button className="btn btn-sm" onClick={() => api('app.openDataFolder')}>Show</button></dd></>}
          <dt>Database</dt><dd>Encrypted with AES-256-GCM (schema version {status.schemaVersion})</dd>
          <dt>Key protection</dt><dd>{status.protection === 'password' ? <Badge kind="ok">{status.lockKind === 'pin' ? 'PIN' : 'Password'}</Badge> : status.strength === 'weak' ? <Badge kind="warn">Computer login — weak on this system</Badge> : <Badge kind="ok">Computer login ({status.osBackend})</Badge>}</dd>
          <dt>Analytics</dt><dd>None. Geranium sends no usage data, crash reports or financial information anywhere.</dd>
        </dl>
        {status.strength === 'weak' && <Callout kind="warn">This computer has no secure keyring available to Geranium, so the key is only lightly protected. Setting a password is strongly recommended.</Callout>}
      </Card>
      <Card title="App lock" sub="A password or PIN is required to open Geranium, and lets it lock itself">
        <div className="stack">
          <div className="form-grid">
            <SelectField label="Protect with" value={kind} onChange={setKind} options={[{ value: 'password', label: 'Password' }, { value: 'pin', label: 'PIN (6–12 digits)' }]} />
            <TextField label={status.protection === 'password' ? 'New password or PIN' : 'Password or PIN'} type="password" value={secret} onChange={setSecret} />
            <TextField label="Confirm" type="password" value={confirmSecret} onChange={setConfirmSecret} />
          </div>
          <ErrorText error={setPw.error} />
          <div><button className="btn btn-primary" disabled={!secret} onClick={() => setPw.run()}>{status.protection === 'password' ? 'Change' : 'Set'} {kind === 'pin' ? 'PIN' : 'password'}</button></div>
          <p className="small muted">The password is never stored; it is used to derive the key that unlocks your data (scrypt). It cannot be reset — keep an encrypted backup. Biometric unlock is not available in this version.</p>
          {status.protection === 'password' && status.osStoreAvailable && (
            <details className="explain"><summary>Remove the password</summary>
              <div className="explain-body stack">
                <TextField label="Current password or PIN" type="password" value={current} onChange={setCurrent} />
                <ErrorText error={removePw.error} />
                <div><button className="btn btn-danger" disabled={!current} onClick={() => removePw.run()}>Remove password</button></div>
              </div>
            </details>
          )}
        </div>
      </Card>
      <Card title="Automatic lock" sub={status.protection === 'password' ? undefined : 'Set a password or PIN to use automatic locking'}>
        <div className="stack">
          <Checkbox label="Lock automatically" checked={a.enabled} onChange={(v) => update({ autoLock: { ...a, enabled: v } })} />
          <div className="form-grid">
            <NumberField label="After inactivity" suffix="minutes" value={a.idleMinutes} step="1" min={1} onChange={(v) => update({ autoLock: { ...a, idleMinutes: Math.max(1, Math.round(v ?? 10)) } })} />
            <NumberField label="Always lock after" suffix="minutes (blank = never)" value={a.maxSessionMinutes} step="1" onChange={(v) => update({ autoLock: { ...a, maxSessionMinutes: v ? Math.round(v) : null } })} />
          </div>
          {!IS_WEB && <Checkbox label="Lock when the computer sleeps or its screen locks" checked={a.onSleep} onChange={(v) => update({ autoLock: { ...a, onSleep: v } })} />}
          <Checkbox label={IS_WEB ? 'Lock when you switch to another tab or window' : 'Lock when Geranium is minimised'} checked={a.onMinimise} onChange={(v) => update({ autoLock: { ...a, onMinimise: v } })} />
        </div>
      </Card>
      <Card title="Network activity this session" sub="Geranium only goes online when you export to Google Sheets. Every request is listed here (no content is logged).">
        <DataTable rows={log.data ?? []} rowKey={(r) => r.at + r.host} empty={<p className="muted">No network requests have been made.</p>} columns={[
          { key: 't', header: 'Time', render: (r) => new Date(r.at).toLocaleTimeString('en-AU') },
          { key: 'h', header: 'Host', render: (r) => r.host },
          { key: 'p', header: 'Purpose', render: (r) => r.purpose },
          { key: 's', header: 'Result', render: (r) => String(r.status) },
        ]} />
        <div className="row" style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => log.reload()}>Refresh</button></div>
      </Card>
    </div>
  );
}

function Notifications({ s }: { s: AppSettings }) {
  const update = useSettingsUpdate();
  const n = s.notifications;
  return (
    <Card title="Reminders" sub="Desktop notifications from this computer only — no server is involved. They appear while Geranium is open and unlocked.">
      <div className="stack">
        <Checkbox label="Show reminders" checked={n.enabled} onChange={(v) => update({ notifications: { ...n, enabled: v } })} />
        <div className="form-grid">
          <TextField label="Not before (time of day)" type="time" value={n.preferredTime} onChange={(v) => update({ notifications: { ...n, preferredTime: v || '09:00' } })} />
        </div>
        <Checkbox label="Repeat a reminder each day until it is dealt with" checked={n.allowRepeat} onChange={(v) => update({ notifications: { ...n, allowRepeat: v } })} />
        <Checkbox label="Include amounts in notifications" checked={n.showAmounts} onChange={(v) => update({ notifications: { ...n, showAmounts: v } })} hint="Off by default because notifications can show on a locked screen." />
        <DataTable rows={Object.entries(REMINDER_LABEL) as [ReminderType, string][]} rowKey={([k]) => k} columns={[
          { key: 'l', header: 'Reminder', render: ([k, l]) => <Checkbox label={l} checked={n.types[k].enabled} onChange={(v) => update({ notifications: { ...n, types: { ...n.types, [k]: { ...n.types[k], enabled: v } } } })} /> },
          { key: 'd', header: 'Days ahead', render: ([k]) => <div style={{ maxWidth: 140 }}><NumberField label={k === 'backup' ? 'Every (days)' : 'Days before'} value={n.types[k].daysBefore} step="1" min={0} onChange={(v) => update({ notifications: { ...n, types: { ...n.types, [k]: { ...n.types[k], daysBefore: Math.max(0, Math.round(v ?? 0)) } } } })} /></div> },
        ]} />
      </div>
    </Card>
  );
}

function ImportRules({ s }: { s: AppSettings }) {
  const update = useSettingsUpdate();
  const st = s.staging;
  return (
    <Card title="When imported transactions wait for review" sub="Waiting transactions are not included in figures until approved">
      <div className="stack">
        <Checkbox label="The file reader was unsure, or the category is unclear" checked={st.lowConfidence} onChange={(v) => update({ staging: { ...st, lowConfidence: v } })} />
        <Checkbox label="It might duplicate a transaction already imported" checked={st.duplicates} onChange={(v) => update({ staging: { ...st, duplicates: v } })} />
        <Checkbox label="It might be a transfer between my accounts" checked={st.transfers} onChange={(v) => update({ staging: { ...st, transfers: v } })} />
        <Checkbox label="It came from a PDF statement" checked={st.allPdf} onChange={(v) => update({ staging: { ...st, allPdf: v } })} />
      </div>
    </Card>
  );
}

export function Settings() {
  const { settings, status, setStatus } = useApp();
  const [tab, setTab] = useState<'preferences' | 'security' | 'notifications' | 'imports'>('preferences');
  if (!settings) return <Loading />;
  return (
    <Page title="Settings & privacy" intro={`Your preferences, how your data is protected, and what (if anything) leaves ${IS_WEB ? 'this browser' : 'this computer'}.`}>
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ value: 'preferences', label: 'Preferences' }, { value: 'security', label: 'Privacy & security' }, ...(IS_WEB ? [] : [{ value: 'notifications' as const, label: 'Reminders' }]), { value: 'imports', label: 'Import review' }]} />
      {tab === 'preferences' && <Preferences s={settings} />}
      {tab === 'security' && (status?.demo ? <Callout kind="neutral">Security settings apply to your own data, not demo mode. <button className="btn btn-sm" onClick={async () => setStatus(await api('app.exitDemo'))}>Leave demo</button></Callout> : <Security />)}
      {tab === 'notifications' && <Notifications s={settings} />}
      {tab === 'imports' && <ImportRules s={settings} />}
    </Page>
  );
}
