import { useEffect, useState } from 'react';
import { api, IS_WEB } from '../lib/api';
import { useApp } from '../lib/app';
import { BrandMark, Callout, Checkbox, DateField, ErrorText, Icon, MoneyField, SelectField, TextField } from '../components/ui';
import { ACCOUNT_TYPE_LABEL, AccountType } from '@domain/accounts';
import type { PeriodKind } from '@domain/periods';
import { todayLocal } from '../components/pickers';

function PrivacyPoints() {
  return (
    <ul className="list-plain small">
      <li><strong>{IS_WEB ? 'Stays in this browser.' : 'Stays on this computer.'}</strong> {IS_WEB ? 'Your records are kept encrypted in this browser’s storage on this device — nothing is uploaded. Clearing this site’s data in your browser deletes them, so keep a backup.' : 'Your records are kept in an encrypted file on this computer.'} There is no Geranium account and no Geranium server.</li>
      <li><strong>No bank logins.</strong> Geranium never asks for bank, broker or super passwords. You import statements and exports yourself.</li>
      <li><strong>No tracking.</strong> Nothing about your finances is sent anywhere. The only time Geranium uses the internet is if you choose to export to Google Sheets.</li>
      <li><strong>You own the data.</strong> Export it to CSV or Excel at any time, and make encrypted backups wherever you like.</li>
      <li><strong>Not financial advice.</strong> Geranium tracks, explains and models. It does not tell you what to buy, sell or decide.</li>
    </ul>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const { status } = useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<'password' | 'pin' | 'os'>('password');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weakOs = status?.osBackend === 'basic_text' || !status?.osStoreAvailable;

  const create = async () => {
    setError(null);
    if (mode !== 'os' && secret !== confirm) { setError(`The ${mode === 'pin' ? 'PINs' : 'passwords'} do not match.`); return; }
    setBusy(true);
    try {
      await api('app.initialise', { password: mode === 'os' ? null : { secret, kind: mode } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-wrap">
      <div className="card lock-card stack-lg">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <div><div className="brand-name">Geranium</div><div className="brand-sub">See where your money went · Understand where it is going · Model where it could go next</div></div>
        </div>
        {step === 1 ? (
          <>
            <h1>{IS_WEB ? 'Your finances, in your browser' : 'Your finances, on your computer'}</h1>
            <p><strong>Your financial records stay {IS_WEB ? 'in this browser' : 'on this computer'} unless you export or back them up.</strong></p>
            <PrivacyPoints />
            <div className="row-between">
              <button className="btn" onClick={async () => { await api('app.enterDemo'); onDone(); }}>Explore with demo data</button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>Set up Geranium</button>
            </div>
          </>
        ) : (
          <>
            <h1>Protect your data</h1>
            <p>Your records are encrypted. Choose how the encryption key is protected.</p>
            <div className="choice-grid" role="radiogroup" aria-label="Protection">
              <button className="choice" role="radio" aria-checked={mode === 'password'} aria-pressed={mode === 'password'} onClick={() => setMode('password')}>
                <strong>Password</strong><div className="small muted">Needed each time Geranium opens. Allows locking and auto-lock.</div>
              </button>
              <button className="choice" role="radio" aria-checked={mode === 'pin'} aria-pressed={mode === 'pin'} onClick={() => setMode('pin')}>
                <strong>PIN</strong><div className="small muted">6–12 digits. Quicker, but less strong than a password.</div>
              </button>
              {!IS_WEB && (
                <button className="choice" role="radio" aria-checked={mode === 'os'} aria-pressed={mode === 'os'} disabled={!status?.osStoreAvailable} onClick={() => setMode('os')}>
                  <strong>This computer’s login</strong><div className="small muted">No password in Geranium. Anyone who can use your computer account can open it.</div>
                </button>
              )}
            </div>
            {mode === 'os' && weakOs && (
              <Callout kind="warn">This computer does not have a secure credential store available to Geranium (for example no keyring on Linux), so the key would only be lightly protected. A password is strongly recommended.</Callout>
            )}
            {mode !== 'os' && (
              <div className="grid grid-2">
                <TextField label={mode === 'pin' ? 'PIN' : 'Password'} type="password" value={secret} onChange={setSecret} autoFocus hint={mode === 'pin' ? '6 to 12 digits' : 'At least 8 characters. A short sentence works well.'} />
                <TextField label={mode === 'pin' ? 'Confirm PIN' : 'Confirm password'} type="password" value={confirm} onChange={setConfirm} />
              </div>
            )}
            {mode !== 'os' && <Callout kind="warn" title="There is no password reset">Your password is not stored anywhere and cannot be recovered. If it is forgotten, the data can only be restored from an encrypted backup (which has its own password).</Callout>}
            <ErrorText error={error} />
            <div className="row-between">
              <button className="btn" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-primary" disabled={busy || (mode !== 'os' && !secret)} onClick={create}>{busy ? 'Creating…' : 'Create encrypted data file'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Unlock({ onDone }: { onDone: () => void }) {
  const { status } = useApp();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const pw = status?.protection === 'password';

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('app.unlock', { secret: pw ? secret : undefined });
      setSecret('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (status && !pw) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lock-wrap">
      <form className="card lock-card stack-lg" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
        <div className="row"><Icon name="lock" size={22} /><h1>Geranium is locked</h1></div>
        {pw ? (
          <TextField label={status?.lockKind === 'pin' ? 'PIN' : 'Password'} type="password" value={secret} onChange={setSecret} autoFocus />
        ) : (
          <p>Geranium uses this computer’s login to unlock your data.</p>
        )}
        <ErrorText error={error} />
        <div className="row-between">
          <button type="button" className="btn btn-ghost" onClick={async () => { await api('app.enterDemo'); onDone(); }}>Explore demo data</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (pw && !secret)}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        </div>
        {pw && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForgot((f) => !f)} aria-expanded={forgot}>Forgotten your {status?.lockKind === 'pin' ? 'PIN' : 'password'}?</button>
            {forgot && (
              <div className="disclaimer" style={{ marginTop: 8 }}>
                The password is not stored anywhere, so it cannot be reset — this is what keeps your data private. If you have an encrypted backup,
                you can move the data folder aside (<code>{status?.dataFolder}</code>), start Geranium again, set a new password and restore the backup.
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'week', label: 'Weekly' }, { value: 'fortnight', label: 'Fortnightly' }, { value: 'month', label: 'Monthly' }, { value: 'quarter', label: 'Quarterly' },
];
const INCOME_KINDS = [
  { value: 'salary', label: 'Salary or wages' }, { value: 'contracting', label: 'Contracting' }, { value: 'sole-trader', label: 'Sole trader or business' },
  { value: 'investment', label: 'Investment income (interest, dividends)' }, { value: 'other', label: 'Other income (rental, government payments…)' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { setSettings, navigate } = useApp();
  const [step, setStep] = useState(1);
  const [periods, setPeriods] = useState<PeriodKind[]>(['week', 'month']);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [kinds, setKinds] = useState<string[]>(['salary']);
  const [gst, setGst] = useState(false);
  const [help, setHelp] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string; type: AccountType; institution: string; balanceCents: number | null; balanceDate: string | null }[]>([]);
  const [draft, setDraft] = useState({ name: '', type: 'transaction' as AccountType, institution: '', balanceCents: null as number | null, balanceDate: todayLocal() as string | null });
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = 7;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const finish = async (goTo?: 'import') => {
    setError(null);
    try {
      for (const a of accounts) {
        await api('accounts.save', { name: a.name, type: a.type, institution: a.institution || null, openingBalance: a.balanceCents !== null && a.balanceDate ? { date: a.balanceDate, balanceCents: a.type === 'credit-card' || a.type === 'mortgage' ? -Math.abs(a.balanceCents) : a.balanceCents, source: 'manual' } : null });
      }
      setAccounts([]);
      const s = await api('settings.update', { onboardingComplete: true, analysisPeriods: periods.length ? periods : ['month'], fortnightAnchor: anchor, incomeKinds: kinds, gstRegistered: gst, hasStudyLoan: help, notifications: { ...(await api('settings.get')).notifications, enabled: notify } });
      setSettings(s);
      onDone();
      if (goTo) navigate(goTo);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="lock-wrap">
      <div className="card lock-card stack-lg" style={{ width: 'min(720px, 100%)' }}>
        <div className="steps" aria-label={`Step ${step} of ${total}`}>{Array.from({ length: total }, (_, i) => <span key={i} className={i < step ? 'done' : ''} />)}</div>
        {step === 1 && (<><h1>Privacy</h1><p><strong>Your financial records stay {IS_WEB ? 'in this browser' : 'on this computer'} unless you export or back them up.</strong></p><PrivacyPoints /></>)}
        {step === 2 && (
          <>
            <h1>How do you like to look at money?</h1>
            <p>Choose any that suit you — you can mix, for example weekly spending and monthly budgets. This can be changed later.</p>
            <div className="choice-grid">{PERIODS.map((p) => <button key={p.value} className="choice" aria-pressed={periods.includes(p.value)} onClick={() => setPeriods(toggle(periods, p.value))}><strong>{p.label}</strong></button>)}</div>
            {periods.includes('fortnight') && <DateField label="A date your fortnight starts (for example a payday)" value={anchor} onChange={setAnchor} />}
          </>
        )}
        {step === 3 && (
          <>
            <h1>Where does your income come from?</h1>
            <div className="choice-grid">{INCOME_KINDS.map((k) => <button key={k.value} className="choice" aria-pressed={kinds.includes(k.value)} onClick={() => setKinds(toggle(kinds, k.value))}><strong>{k.label}</strong></button>)}</div>
            {(kinds.includes('contracting') || kinds.includes('sole-trader')) && <Checkbox label="I am registered for GST" checked={gst} onChange={setGst} hint="Only tick this if you have registered. Geranium does not assume sole traders are registered." />}
            <Checkbox label="I have a HELP or other study/training loan" checked={help} onChange={setHelp} hint="Used only for the tax estimate." />
          </>
        )}
        {step === 4 && (
          <>
            <h1>Add your accounts</h1>
            <p>Add the accounts you want to track. Balances are optional and are shown with the date you enter — Geranium never shows them as live.</p>
            {accounts.length > 0 && <ul className="list-plain">{accounts.map((a, i) => <li key={i} className="row-between"><span>{a.name} <span className="muted small">· {ACCOUNT_TYPE_LABEL[a.type]}</span></span><button className="btn btn-ghost btn-sm" onClick={() => setAccounts(accounts.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>}
            <div className="form-grid">
              <TextField label="Account name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="e.g. Everyday" />
              <SelectField label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value: value as AccountType, label }))} />
              <TextField label="Institution (optional)" value={draft.institution} onChange={(v) => setDraft({ ...draft, institution: v })} />
              <MoneyField label="Balance (optional)" cents={draft.balanceCents} onChange={(c) => setDraft({ ...draft, balanceCents: c })} hint="For cards and loans, enter the amount owed." />
              <DateField label="Balance as at" value={draft.balanceDate} onChange={(d) => setDraft({ ...draft, balanceDate: d })} />
            </div>
            <div><button className="btn" disabled={!draft.name.trim()} onClick={() => { setAccounts([...accounts, draft]); setDraft({ name: '', type: 'transaction', institution: '', balanceCents: null, balanceDate: todayLocal() }); }}><Icon name="plus" size={16} /> Add account</button></div>
          </>
        )}
        {step === 5 && (
          <>
            <h1>Import your history</h1>
            <p>Download statements or transaction exports from your bank’s website, then import the files. Supported: <strong>CSV, OFX/QFX, QIF, XLS/XLSX</strong> and <strong>PDF statements</strong> (text-based PDFs; scanned images need a CSV or OFX instead).</p>
            <Callout>Imports go through a review screen first. Anything uncertain — possible duplicates, possible transfers, unclear categories — waits in the Review inbox so it never quietly changes your figures.</Callout>
          </>
        )}
        {step === 6 && (<><h1>Review and categorise</h1><p>Geranium suggests categories using transparent rules you can see and change. When you correct the same merchant a couple of times, it offers to create a rule — it never creates one without asking unless you turn on automatic learning.</p></>)}
        {step === 7 && (
          <>
            <h1>Reminders (optional)</h1>
            <p>Geranium can show desktop notifications for bills, term-deposit maturities, tax time and backups. Nothing is sent from a server; reminders appear while Geranium is open.</p>
            <Checkbox label="Turn on reminders" checked={notify} onChange={setNotify} hint="You can choose which reminders and when in Settings. Amounts are hidden in notifications unless you allow them." />
          </>
        )}
        <ErrorText error={error} />
        <div className="row-between">
          <button className="btn" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</button>
          <div className="row">
            {step < total && step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step + 1)}>Skip</button>}
            {step === 5 && <button className="btn" onClick={() => finish('import')}>Finish and import a file</button>}
            {step < total ? <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Continue</button> : <button className="btn btn-primary" onClick={() => finish()}>Start using Geranium</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
