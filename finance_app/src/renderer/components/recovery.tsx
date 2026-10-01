import { useState } from 'react';
import { api, IS_WEB, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { recoveryKeyMailto, recoveryKeyText } from '@shared/recovery';
import { Callout, Checkbox, ErrorText, SelectField, TextField } from './ui';

/**
 * Shows a new recovery key once, with ways to keep it: email it to yourself (opens your own
 * email app with a draft; Geranium sends nothing), save it as a file, or print it.
 */
export function RecoveryKeyPanel({ recoveryKey, createdAt, onDone, doneLabel = 'Continue' }: { recoveryKey: string; createdAt: string | null; onDone: () => void; doneLabel?: string }) {
  const { toast } = useApp();
  const [kept, setKept] = useState(false);
  const text = recoveryKeyText(recoveryKey, IS_WEB ? 'web' : 'desktop', createdAt);
  const save = useAction(async () => {
    const saved = await api('security.saveRecoveryKey', { text });
    if (saved) toast(IS_WEB ? 'Recovery key downloaded.' : 'Recovery key saved.', 'success');
  });
  const print = () => {
    document.body.classList.add('printing-recovery');
    window.print();
    document.body.classList.remove('printing-recovery');
  };
  return (
    <div className="stack">
      <p>This key can unlock your data if you ever forget your password. <strong>It is shown only now</strong> — keep a copy somewhere safe, away from this {IS_WEB ? 'browser' : 'computer'}.</p>
      <div className="recovery-key print-recovery" aria-label="Your recovery key">
        <div className="recovery-key-label">Geranium recovery key</div>
        <code>{recoveryKey}</code>
        <pre className="print-only">{text}</pre>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={recoveryKeyMailto(text)}>Email it to myself</a>
        <button type="button" className="btn" onClick={() => save.run()} disabled={save.pending}>Save as a file</button>
        <button type="button" className="btn" onClick={print}>Print</button>
      </div>
      <ErrorText error={save.error} />
      <p className="small muted">
        <strong>Email it to myself</strong> opens a draft in your own email app — add your address and send it. Geranium doesn’t send anything.
        Email isn’t private storage: anyone who can read that email and also use this {IS_WEB ? 'browser' : 'computer'} could open your data, so a printout or a password manager is safer.
        If nothing opens, use Save or Print instead.
      </p>
      <Checkbox label="I’ve kept my recovery key somewhere safe" checked={kept} onChange={setKept} />
      <div><button type="button" className="btn btn-primary" disabled={!kept} onClick={onDone}>{doneLabel}</button></div>
    </div>
  );
}

/** Lock screen: use the recovery key to choose a new password or PIN. */
export function RecoverForm({ onDone }: { onDone: () => void }) {
  const { setStatus } = useApp();
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<'password' | 'pin'>('password');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (secret !== confirm) { setError(`The new ${kind === 'pin' ? 'PINs' : 'passwords'} do not match.`); return; }
    setBusy(true);
    try {
      setStatus(await api('app.recover', { key, secret, kind }));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    // Enter submits this form, not the password form it sits inside on the lock screen.
    <div className="stack" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (key.trim() && secret && !busy) void submit(); } }}>
      <TextField label="Recovery key" value={key} onChange={setKey} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" hint="24 letters and numbers. Dashes, spaces and capitals don’t matter." autoFocus />
      <SelectField label="Protect with" value={kind} onChange={(v) => setKind(v as 'password' | 'pin')} options={[{ value: 'password', label: 'A new password' }, { value: 'pin', label: 'A new PIN (6–12 digits)' }]} />
      <TextField label={kind === 'pin' ? 'New PIN' : 'New password'} type="password" value={secret} onChange={setSecret} />
      <TextField label={kind === 'pin' ? 'Confirm new PIN' : 'Confirm new password'} type="password" value={confirm} onChange={setConfirm} />
      <ErrorText error={error} />
      <div><button type="button" className="btn btn-primary" disabled={busy || !key.trim() || !secret} onClick={() => void submit()}>{busy ? 'Checking…' : 'Unlock and set new password'}</button></div>
      <p className="small muted">Your recovery key keeps working afterwards. If someone else may have seen it, make a new one in Settings › Privacy &amp; security.</p>
    </div>
  );
}

/** Settings: make, replace or remove the recovery key. */
export function RecoveryKeySettings({ createdAt, onChanged }: { createdAt: string | null; onChanged: () => void }) {
  const { toast } = useApp();
  const [fresh, setFresh] = useState<{ key: string; createdAt: string | null } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const make = useAction(async () => {
    setFresh(await api('security.createRecoveryKey'));
    setConfirmReplace(false);
    onChanged();
  });
  const remove = useAction(async () => {
    await api('security.removeRecoveryKey');
    toast('Recovery key removed. The old key no longer works.', 'success');
    onChanged();
  });
  if (fresh) return <RecoveryKeyPanel recoveryKey={fresh.key} createdAt={fresh.createdAt} onDone={() => setFresh(null)} doneLabel="Done" />;
  return (
    <div className="stack">
      {createdAt
        ? <p>You have a recovery key, made on {new Date(createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}. If you forget your password, use it on the lock screen to choose a new one.</p>
        : <Callout kind="warn" title="No recovery key">If you forget your password, your data can only come back from an encrypted backup. A recovery key lets you set a new password instead.</Callout>}
      <ErrorText error={make.error ?? remove.error} />
      {confirmReplace ? (
        <Callout kind="warn" title="Make a new recovery key?">
          Your current recovery key will stop working.
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => make.run()} disabled={make.pending}>Make a new key</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReplace(false)}>Cancel</button>
          </div>
        </Callout>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={make.pending} onClick={() => (createdAt ? setConfirmReplace(true) : make.run())}>{createdAt ? 'Make a new recovery key' : 'Make a recovery key'}</button>
          {createdAt && <button type="button" className="btn btn-ghost" disabled={remove.pending} onClick={() => remove.run()}>Remove it</button>}
        </div>
      )}
    </div>
  );
}
