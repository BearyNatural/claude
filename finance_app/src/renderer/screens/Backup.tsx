import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Callout, Card, ErrorText, Page, TextField, useConfirm } from '../components/ui';
import { formatDate } from '@domain/dates';

export function Backup() {
  const { settings, status, toast } = useApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [restoreInfo, setRestoreInfo] = useState<{ fileName: string; createdAt: string; appVersion: string; schemaVersion: number } | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const confirm = useConfirm();
  const create = useAction(async () => {
    if (pw !== pw2) throw new Error('The passwords do not match.');
    const r = await api('backup.create', { password: pw });
    if (r) { toast(`Encrypted backup saved to ${r.path}`, 'success'); setPw(''); setPw2(''); }
  });
  const choose = useAction(async () => setRestoreInfo(await api('backup.choose')));
  const restore = useAction(async () => {
    if (!(await confirm.ask('Replace your data with this backup?', <><p>Everything in Paperbark will be replaced by the backup from {restoreInfo ? formatDate(restoreInfo.createdAt.slice(0, 10), { long: true }) : ''}.</p><p>An encrypted copy of your current data is kept in the data folder first.</p></>, 'Restore backup', true))) return;
    const r = await api('backup.restore', { password: restorePw });
    toast(`Backup restored (${r.counts.transactions ?? 0} transactions).`, 'success');
    setRestoreInfo(null);
    setRestorePw('');
  });
  if (status?.demo) return (
    <Page title="Backup & restore" intro="Paperbark does not keep cloud backups. You choose where an encrypted backup goes: this computer, a USB drive, a NAS, or a synced cloud folder.">
      <Callout kind="neutral" title="Not available in demo mode">Backups are for your own data, and demo data is never saved. Leave demo mode to make or restore an encrypted backup.</Callout>
      <Card title="How backups work">
        <ul className="small">
          <li>A backup holds your whole database and attached documents in one file, encrypted with a password you choose.</li>
          <li>The password is not stored anywhere. Without it, the backup cannot be opened by anyone.</li>
          <li>Restoring checks the file first, shows what it contains, and keeps an encrypted copy of your current data before replacing it.</li>
        </ul>
      </Card>
    </Page>
  );
  return (
    <Page title="Backup & restore" intro="Paperbark does not keep cloud backups. You choose where an encrypted backup goes: this computer, a USB drive, a NAS, or a Dropbox, OneDrive, Google Drive or iCloud folder.">
      <Card title="Make an encrypted backup" sub={settings?.lastBackupAt ? `Last backup: ${formatDate(settings.lastBackupAt.slice(0, 10), { long: true })}` : 'No backup made yet'}>
        <div className="stack">
          <p className="small">The backup contains your whole database and attached documents, encrypted with AES-256-GCM using a key derived from the password below (scrypt). The password is not stored in the backup or anywhere else.</p>
          <Callout kind="warn" title="Keep this password safe">If it is lost, the backup cannot be opened by anyone — including you.</Callout>
          <div className="form-grid">
            <TextField label="Backup password" type="password" value={pw} onChange={setPw} hint="At least 8 characters. It can differ from your app password." />
            <TextField label="Confirm backup password" type="password" value={pw2} onChange={setPw2} />
          </div>
          <ErrorText error={create.error} />
          <div><button className="btn btn-primary" disabled={pw.length < 8 || create.pending} onClick={() => create.run()}>{create.pending ? 'Encrypting…' : 'Save encrypted backup…'}</button></div>
        </div>
      </Card>
      <Card title="Restore from a backup">
        <div className="stack">
          <div><button className="btn" onClick={() => choose.run()}>Choose backup file…</button></div>
          <ErrorText error={choose.error} />
          {restoreInfo && (
            <>
              <p className="small">{restoreInfo.fileName}: made {formatDate(restoreInfo.createdAt.slice(0, 10), { long: true })} by Paperbark {restoreInfo.appVersion} (data version {restoreInfo.schemaVersion}). Older backups are upgraded automatically.</p>
              <TextField label="Backup password" type="password" value={restorePw} onChange={setRestorePw} />
              <ErrorText error={restore.error} />
              <div><button className="btn btn-danger" disabled={!restorePw || restore.pending} onClick={() => restore.run()}>Restore…</button></div>
            </>
          )}
        </div>
      </Card>
      <Callout kind="neutral">A cloud folder (Dropbox, OneDrive, Google Drive, iCloud Drive) is just a folder to Paperbark — the file is encrypted before it is saved, so the provider only ever sees an encrypted file.</Callout>
      {confirm.node}
    </Page>
  );
}
