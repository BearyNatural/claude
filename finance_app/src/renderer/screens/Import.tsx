import { useEffect, useMemo, useState } from 'react';
import { api, clearShared, IS_WEB, useAction, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, ErrorText, Explain, Icon, Loading, Money, MoneyField, Page, SelectField, TextField, useConfirm } from '../components/ui';
import { AccountSelect, CategorySelect, useAccounts } from '../components/pickers';
import { DATE_FORMAT_LABEL, DateFormat } from '@domain/import/dateFormats';
import { formatDate } from '@domain/dates';
import { ACCOUNT_TYPE_LABEL, AccountType } from '@domain/accounts';
import type { ApiOutput } from '../../main/api';
import type { ImportPreviewRow, ImportSession, ReconciliationDTO } from '../../shared/types';

/** Add an account without leaving the import (the first import usually needs one). */
function QuickAccount({ onCreated, hint }: { onCreated: (id: string) => void; hint?: ImportSession['statements'][number]['accountHint'] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(hint?.name ?? '');
  const [type, setType] = useState<AccountType>(hint?.type && hint.type in ACCOUNT_TYPE_LABEL ? hint.type as AccountType : 'transaction');
  const number = hint?.number ?? null;
  const save = useAction(async () => {
    // The statement's account number is saved too, so the next statement matches this account by itself.
    const id = await api('accounts.save', { name: name.trim(), type, number, bsb: hint?.bsb ?? null });
    clearShared();
    onCreated(String(id));
    setOpen(false);
    setName('');
  });
  if (!open) return <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>New account…</button></div>;
  return (
    <div className="stack-sm">
      <TextField label="Account name" value={name} onChange={setName} hint={number ? `Account number ending ${number.slice(-4)} will be saved with it.` : 'For example “Everyday” or “Credit card”'} autoFocus />
      <SelectField label="Type" value={type} onChange={(v) => setType(v as AccountType)} options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
      <ErrorText error={save.error} />
      <div className="row"><button type="button" className="btn btn-sm btn-primary" disabled={!name.trim() || save.pending} onClick={() => save.run()}>Add account</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

type Kind = 'date' | 'processing-date' | 'description' | 'amount' | 'debit' | 'credit' | 'indicator' | 'balance' | 'reference' | 'account' | 'payee' | 'category' | 'ignore';
const KIND_LABEL: Record<Kind, string> = {
  date: 'Transaction date', 'processing-date': 'Processing date', description: 'Description', amount: 'Amount', debit: 'Debit (money out)', credit: 'Credit (money in)',
  indicator: 'DR/CR indicator', balance: 'Running balance', reference: 'Reference', account: 'Account number', payee: 'Payee / merchant', category: 'Category (from file)', ignore: 'Ignore this column',
};

function Mapping({ session, onApplied }: { session: ImportSession; onApplied: (s: ImportSession) => void }) {
  const kindsQ = useApi('imports.mappingKinds', { sessionId: session.sessionId }, [session.sessionId, session.selectedSheet]);
  const detected = session.mapping as { headerRow: number | null; firstDataRow: number; dateFormat: DateFormat; positiveIsCredit?: boolean } | null;
  const width = Math.max(session.headers.length, ...session.sampleRows.map((r) => r.length));
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [dateFormat, setDateFormat] = useState<DateFormat>(detected?.dateFormat ?? 'DMY');
  const [positiveIsCredit, setPositiveIsCredit] = useState(detected?.positiveIsCredit ?? true);
  const [headerRow, setHeaderRow] = useState<number | null>(detected?.headerRow ?? null);
  const [firstDataRow, setFirstDataRow] = useState(detected?.firstDataRow ?? 0);
  useEffect(() => {
    if (kindsQ.data) setKinds(kindsQ.data.length ? (kindsQ.data as Kind[]) : Array.from({ length: width }, () => 'ignore'));
  }, [kindsQ.data, width]);
  const apply = useAction(async () => onApplied(await api('imports.applyMapping', { sessionId: session.sessionId, kinds, headerRow, firstDataRow, dateFormat, positiveIsCredit })));
  const hasAmount = kinds.includes('amount') || kinds.includes('debit') || kinds.includes('credit');
  return (
    <Card title="Which column holds what?" sub="Check each column. Geranium has made its best guess.">
      <div className="stack">
        {session.mappingQuestions.map((q) => <Callout key={q} kind="warn">{q}</Callout>)}
        {session.mappingNotes.map((n) => <Callout key={n} kind="neutral">{n}</Callout>)}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>{Array.from({ length: width }, (_, i) => (
                <th key={i} style={{ minWidth: 150 }}>
                  <label className="sr-only" htmlFor={`col-${i}`}>Column {i + 1} ({session.headers[i]})</label>
                  <select id={`col-${i}`} className="input" value={kinds[i] ?? 'ignore'} onChange={(e) => setKinds(kinds.map((k, j) => (j === i ? (e.target.value as Kind) : k)))}>
                    {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <div className="small muted" style={{ marginTop: 4 }}>{session.headers[i] ?? `Column ${i + 1}`}</div>
                </th>
              ))}</tr>
            </thead>
            <tbody>{session.sampleRows.slice(0, 8).map((r, ri) => <tr key={ri}>{Array.from({ length: width }, (_, i) => <td key={i} className="small">{r[i] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="form-grid">
          <SelectField label="Date format" value={dateFormat} onChange={setDateFormat} options={Object.entries(DATE_FORMAT_LABEL).map(([value, label]) => ({ value: value as DateFormat, label }))} hint="Australian files are usually day/month/year." />
          {kinds.includes('amount') && !kinds.includes('indicator') && (
            <SelectField label="Are debits negative numbers?" value={positiveIsCredit ? 'yes' : 'no'} onChange={(v) => setPositiveIsCredit(v === 'yes')} options={[{ value: 'yes', label: 'Yes — negative is money out' }, { value: 'no', label: 'No — positive amounts are money out (e.g. card purchases)' }]} />
          )}
          <SelectField label="Heading row" value={headerRow === null ? 'none' : String(headerRow)} onChange={(v) => { const h = v === 'none' ? null : Number(v); setHeaderRow(h); setFirstDataRow(h === null ? firstDataRow : h + 1); }} options={[{ value: 'none', label: 'No heading row' }, ...[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Row ${n + 1}` }))]} />
        </div>
        <ErrorText error={apply.error} />
        <div className="form-actions"><button className="btn btn-primary" disabled={!kinds.includes('date') || !hasAmount || apply.pending} onClick={() => apply.run()}>Use these columns</button></div>
      </div>
    </Card>
  );
}

function ReconciliationPanel({ rec }: { rec: ReconciliationDTO }) {
  const kind = rec.status === 'reconciled' ? 'ok' : rec.status === 'difference' ? 'warn' : 'neutral';
  return (
    <Card title="Statement check" sub="Opening balance + transactions should equal the closing balance">
      <div className="stack">
        <dl className="kv">
          <dt>Statement opening balance</dt><dd><Money cents={rec.openingCents} /></dd>
          <dt>Transaction movement</dt><dd><Money cents={rec.movementCents} signed /></dd>
          <dt>Expected closing balance</dt><dd><Money cents={rec.expectedClosingCents} /></dd>
          <dt>Statement closing balance</dt><dd><Money cents={rec.closingCents} /></dd>
          {rec.differenceCents !== null && rec.status === 'difference' && <><dt>Difference</dt><dd><strong><Money cents={Math.abs(rec.differenceCents)} /></strong></dd></>}
        </dl>
        <Callout kind={kind}>{rec.status === 'reconciled' ? <strong>{rec.message}</strong> : rec.message}</Callout>
        {rec.hints.length > 0 && <ul className="small">{rec.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
      </div>
    </Card>
  );
}

type Preview = ApiOutput<'imports.preview'>;

type CommitResult = ApiOutput<'imports.commit'>;

const maskNumber = (n: string | null | undefined) => (n ? `••${n.slice(-4)}` : null);
const statementLabel = (s: ImportSession['statements'][number]) => [s.accountHint?.name, maskNumber(s.accountHint?.number)].filter(Boolean).join(' ') || `Statement ${s.index + 1}`;

function Review({ session, index, initialAccountId, onDone, onCancel, onBack }: {
  session: ImportSession; index: number; initialAccountId?: string | null; onDone: (r: CommitResult) => void; onCancel: () => void; onBack?: () => void;
}) {
  const stmt = index;
  const st = session.statements[stmt];
  const [accountId, setAccountId] = useState<string | null>(initialAccountId ?? st?.suggestedAccountId ?? null);
  const [opening, setOpening] = useState<number | null>(st?.openingBalanceDerived ? null : st?.openingBalanceCents ?? null);
  const [closing, setClosing] = useState<number | null>(st?.closingBalanceCents ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<Record<number, { include?: boolean; categoryId?: string | null; amountCents?: number; date?: string; description?: string }>>({});
  const [profileName, setProfileName] = useState('');
  const [keepFile, setKeepFile] = useState(session.format === 'pdf');
  const [editing, setEditing] = useState<ImportPreviewRow | null>(null);
  const [filter, setFilter] = useState<'all' | 'review' | 'duplicates'>('all');
  const load = useAction(async () => {
    if (!accountId) return;
    setPreview(await api('imports.preview', { sessionId: session.sessionId, statementIndex: stmt, accountId, openingCents: opening, closingCents: closing }));
  });
  useEffect(() => { void load.run(); }, [accountId, stmt]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = useAction(async () => {
    const rows = (preview?.rows ?? []).map((r) => ({ index: r.index, include: edits[r.index]?.include ?? r.include, ...(edits[r.index]?.categoryId !== undefined ? { categoryId: edits[r.index].categoryId } : {}), ...(edits[r.index]?.amountCents !== undefined ? { amountCents: edits[r.index].amountCents } : {}), ...(edits[r.index]?.date ? { date: edits[r.index].date } : {}), ...(edits[r.index]?.description ? { description: edits[r.index].description } : {}) }));
    onDone(await api('imports.commit', { sessionId: session.sessionId, statementIndex: stmt, accountId: accountId!, keepSourceFile: keepFile, saveProfileName: profileName.trim() || null, openingCents: opening, closingCents: closing, rows }));
  });
  const suspects = new Set(preview?.reconciliation.suspectIndexes ?? []);
  const rows = (preview?.rows ?? []).filter((r) => filter === 'all' || (filter === 'review' ? r.willStage || r.confidence !== 'high' : r.duplicate.status !== 'new'));
  const included = (preview?.rows ?? []).filter((r) => edits[r.index]?.include ?? r.include);
  if (!st) return <Callout kind="warn">No statements were found in this file.</Callout>;
  return (
    <div className="stack-lg">
      {onBack && <div><button className="btn btn-sm" onClick={onBack}>← All accounts in this statement</button></div>}
      <Card title={session.statements.length > 1 ? `Import review: ${statementLabel(st)}` : 'Import review'} sub={`${session.fileName} · ${session.format.toUpperCase()}${st.periodStart ? ` · ${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)}` : ''} · ${st.transactionCount} transactions detected`}>
        <div className="stack">
          {st.ocrRequired && <Callout kind="danger">This PDF is a scanned image. Its text could not be read, so nothing will be imported from it. Please use a CSV or OFX export of the same statement.</Callout>}
          {st.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
          {session.alreadyImported && <Callout kind="warn">This exact file was imported on {formatDate(session.alreadyImported.importedAt.slice(0, 10))}. Rows already imported will be recognised as duplicates.</Callout>}
          <div className="form-grid">
            <div className="stack-sm">
              <AccountSelect label="Import into account" value={accountId} onChange={setAccountId} />
              <QuickAccount onCreated={setAccountId} hint={st.accountHint} />
            </div>
            <MoneyField label="Opening balance (from statement)" cents={opening} onChange={setOpening} allowNegative hint={st.openingBalanceDerived ? 'This file does not include one — type it from your statement to check the import.' : undefined} />
            <MoneyField label="Closing balance (from statement)" cents={closing} onChange={setClosing} allowNegative />
          </div>
          <div className="row"><button className="btn btn-sm" disabled={!accountId} onClick={() => load.run()}>Re-check with these balances</button></div>
          {!accountId && <Callout>Choose the account this statement belongs to. Card and loan statements show amounts owed.</Callout>}
        </div>
      </Card>
      <ErrorText error={load.error} />
      {preview && (
        <>
          <ReconciliationPanel rec={preview.reconciliation} />
          <Card title="Transactions" sub={`${preview.counts.total} rows · ${preview.counts.duplicates} already imported · ${preview.counts.possibleDuplicates} possible duplicates · ${preview.counts.toStage} will wait in the Review inbox`}
            actions={<div className="segmented" role="group" aria-label="Show">{(['all', 'review', 'duplicates'] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{{ all: 'All', review: 'Needs a look', duplicates: 'Duplicates' }[f]}</button>)}</div>}>
            <DataTable rows={rows} rowKey={(r) => String(r.index)} maxHeight={520} columns={[
              { key: 'i', header: 'Import', width: '60px', render: (r) => <input type="checkbox" aria-label={`Import ${r.description}`} checked={edits[r.index]?.include ?? r.include} onChange={(e) => setEdits({ ...edits, [r.index]: { ...edits[r.index], include: e.target.checked } })} /> },
              { key: 'd', header: 'Date', render: (r) => <DateText date={edits[r.index]?.date ?? r.date} /> },
              { key: 'desc', header: 'Description', render: (r) => (
                <span>{edits[r.index]?.description ?? r.description}
                  {r.issues.length > 0 && <div className="small" style={{ color: 'var(--warn-ink)' }}>{r.issues.join('; ')}</div>}
                  {r.duplicate.status !== 'new' && <div className="small muted">{r.duplicate.reasons.join(', ')}</div>}
                  {suspects.has(r.index) && <div><Badge kind="warn">Check this row</Badge></div>}
                </span>) },
              { key: 'a', header: 'Amount', num: true, render: (r) => <Money cents={edits[r.index]?.amountCents ?? r.amountCents} signed /> },
              { key: 'conf', header: 'Confidence', render: (r) => r.duplicate.status === 'duplicate' ? <Badge>Already imported</Badge> : r.duplicate.status === 'possible-duplicate' ? <Badge kind="warn">Possible duplicate</Badge> : r.confidence === 'high' ? <Badge kind="ok"><Icon name="check" size={12} />High</Badge> : <Badge kind="warn">Review</Badge> },
              { key: 'c', header: 'Category', render: (r) => (
                <div style={{ minWidth: 190 }}>
                  <CategorySelect label="" value={edits[r.index]?.categoryId !== undefined ? edits[r.index].categoryId! : r.suggestedCategoryId} onChange={(v) => setEdits({ ...edits, [r.index]: { ...edits[r.index], categoryId: v } })} />
                  <div className="small muted" title={r.categoryExplanation}>{r.categoryConfidence === 'low' ? 'No confident match' : r.categoryConfidence === 'medium' ? 'Suggested' : 'From your rule'}</div>
                </div>) },
              { key: 'e', header: '', render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>Correct</button> },
            ]} />
          </Card>
          <Card title="Finish">
            <div className="stack">
              {session.mapping !== null && !session.profileMatch && <TextField label="Save this column layout as a profile (optional)" value={profileName} onChange={setProfileName} placeholder="e.g. Example Bank transaction export" hint="Next time a file with the same layout is imported, the columns are recognised automatically." />}
              {session.profileMatch && <Callout kind="neutral">Columns recognised using your saved profile “{session.profileMatch.name}”.</Callout>}
              <Checkbox label="Keep a copy of the original file (encrypted, linked to this import)" checked={keepFile} onChange={setKeepFile} hint="Useful as a source record — especially for business and tax records." />
              {st.rejectedRows.length > 0 && (
                <details className="explain"><summary>{st.rejectedRows.length} row(s) could not be read and will not be imported</summary><ul className="explain-body small">{st.rejectedRows.map((r) => <li key={r.sourceRow}>Row {r.sourceRow}: {r.reason} — <code>{r.raw}</code></li>)}</ul></details>
              )}
              <ErrorText error={commit.error} />
              <div className="row-between">
                <button className="btn" onClick={onBack ?? onCancel}>{onBack ? 'Back' : 'Cancel import'}</button>
                <button className="btn btn-primary" disabled={!accountId || commit.pending || included.length === 0} onClick={() => commit.run()}>Import {included.length} transaction{included.length === 1 ? '' : 's'}</button>
              </div>
            </div>
          </Card>
        </>
      )}
      {editing && (
        <RowEditor row={editing} current={edits[editing.index]} onClose={() => setEditing(null)} onSave={(e) => { setEdits({ ...edits, [editing.index]: { ...edits[editing.index], ...e } }); setEditing(null); }} />
      )}
    </div>
  );
}

/** A statement that lists several accounts: match each to an account, then import them together or one by one. */
function AccountsInFile({ session, onReview, onImported, onCancel }: {
  session: ImportSession; onReview: (index: number, accountId: string | null) => void; onImported: (results: { label: string; r: CommitResult }[]) => void; onCancel: () => void;
}) {
  const { accounts } = useAccounts();
  const [choice, setChoice] = useState<Record<number, string | null>>(() => Object.fromEntries(session.statements.map((s) => [s.index, s.suggestedAccountId])));
  const [keepFile, setKeepFile] = useState(true);
  const waiting = session.statements.filter((s) => !s.importedInto && s.transactionCount > 0);
  const ready = waiting.filter((s) => choice[s.index]);
  const chosen = ready.map((s) => choice[s.index]);
  const doubled = chosen.some((a, i) => chosen.indexOf(a) !== i);
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? 'an account';
  const importAll = useAction(async () => {
    const r = await api('imports.commitAll', { sessionId: session.sessionId, keepSourceFile: keepFile, items: ready.map((s) => ({ statementIndex: s.index, accountId: choice[s.index]! })) });
    onImported(r.results.map((x) => ({ label: `${statementLabel(session.statements[x.statementIndex])} → ${nameOf(x.accountId)}`, r: x })));
  });
  return (
    <Card title="Accounts in this statement" sub={`${session.fileName} · ${session.statements.length} accounts`}>
      <div className="stack">
        <p>This statement covers several accounts. Each one is matched to your account with the same account number. Check the matches, then import them all at once or review them one at a time.</p>
        {session.alreadyImported && <Callout kind="warn">This exact file was imported on {formatDate(session.alreadyImported.importedAt.slice(0, 10))}. Rows already imported will be recognised as duplicates.</Callout>}
        <DataTable rows={session.statements} rowKey={(s) => String(s.index)} columns={[
          { key: 'a', header: 'On the statement', render: (s) => <span><strong>{s.accountHint?.name ?? `Statement ${s.index + 1}`}</strong><div className="small muted">{[maskNumber(s.accountHint?.number), s.periodStart ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : null].filter(Boolean).join(' · ')}</div></span> },
          { key: 'n', header: 'Transactions', num: true, render: (s) => s.transactionCount },
          { key: 'to', header: 'Import into', render: (s) => s.importedInto ? <Badge kind="ok"><Icon name="check" size={12} />Imported into {nameOf(s.importedInto)}</Badge>
            : s.transactionCount === 0 ? <span className="small muted">Nothing to import</span>
            : (
              <div className="stack-sm" style={{ minWidth: 220 }}>
                <AccountSelect label="" value={choice[s.index] ?? null} onChange={(v) => setChoice({ ...choice, [s.index]: v })} placeholder="Choose an account" />
                {!choice[s.index] && <QuickAccount hint={s.accountHint} onCreated={(id) => setChoice({ ...choice, [s.index]: id })} />}
                {choice[s.index] && s.accountHint?.number && !accounts.find((a) => a.id === choice[s.index])?.numberMasked?.endsWith(s.accountHint.number.slice(-4)) && (
                  <span className="small muted">Tip: add the account number ending {s.accountHint.number.slice(-4)} to this account (Accounts › Edit) so it is matched automatically next time.</span>
                )}
              </div>
            ) },
          { key: 'r', header: '', render: (s) => !s.importedInto && s.transactionCount > 0 && <button className="btn btn-sm" disabled={!choice[s.index]} onClick={() => onReview(s.index, choice[s.index] ?? null)}>Review</button> },
        ]} />
        {waiting.length > ready.length && <Callout>Accounts without a match are left out. Choose an account for them, add a new one, or leave them for later.</Callout>}
        {doubled && <Callout kind="warn">Two statements are going into the same account. Check that is what you meant.</Callout>}
        <Checkbox label="Keep a copy of the original file (encrypted, linked to these imports)" checked={keepFile} onChange={setKeepFile} />
        <ErrorText error={importAll.error} />
        <div className="row-between">
          <button className="btn" onClick={onCancel}>Cancel import</button>
          <button className="btn btn-primary" disabled={ready.length === 0 || importAll.pending} onClick={() => importAll.run()}>
            {importAll.pending ? 'Importing…' : `Import ${ready.length} account${ready.length === 1 ? '' : 's'}`}
          </button>
        </div>
        <p className="small muted">Each account is checked exactly as on the review screen: rows already imported are skipped, balances are reconciled, and anything uncertain waits in the Review inbox.</p>
      </div>
    </Card>
  );
}

function RowEditor({ row, current, onSave, onClose }: { row: ImportPreviewRow; current?: { amountCents?: number; date?: string; description?: string }; onSave: (e: { amountCents?: number; date?: string; description?: string }) => void; onClose: () => void }) {
  const amt = current?.amountCents ?? row.amountCents;
  const [dir, setDir] = useState<'in' | 'out'>(amt < 0 ? 'out' : 'in');
  const [abs, setAbs] = useState<number | null>(Math.abs(amt));
  const [date, setDate] = useState<string | null>(current?.date ?? row.date);
  const [desc, setDesc] = useState(current?.description ?? row.description);
  return (
    <Dialog title="Correct this row" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSave({ amountCents: (dir === 'out' ? -1 : 1) * (abs ?? 0), date: date ?? row.date, description: desc })}>Use correction</button></>}>
      <p className="small muted">Corrections are recorded in the transaction’s history. The original row is always kept.</p>
      <div className="form-grid">
        <DateField label="Date" value={date} onChange={setDate} />
        <SelectField label="Money" value={dir} onChange={setDir} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} />
        <MoneyField label="Amount" cents={abs} onChange={setAbs} />
        <TextField label="Description" value={desc} onChange={setDesc} />
      </div>
    </Dialog>
  );
}

function History() {
  const q = useApi('imports.list', undefined, []);
  const { toast } = useApp();
  const confirm = useConfirm();
  const [rec, setRec] = useState<{ id: string; opening: number | null; closing: number | null } | null>(null);
  if (!q.data) return <Loading />;
  return (
    <Card title="Import history" sub="Every import can be checked again or undone">
      <DataTable rows={q.data} rowKey={(i) => i.id} empty={<p className="muted">Nothing imported yet.</p>} maxHeight={420} columns={[
        { key: 'd', header: 'Imported', render: (i) => <DateText date={i.importedAt.slice(0, 10)} /> },
        { key: 'f', header: 'File', render: (i) => <span>{i.fileName}<div className="muted small">{i.accountName} · {i.format.toUpperCase()}{i.periodStart ? ` · ${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : ''}</div></span> },
        { key: 'n', header: 'Rows', render: (i) => <span className="small">{i.added} added{i.staged ? ` · ${i.staged} to review` : ''}{i.duplicates ? ` · ${i.duplicates} duplicates skipped` : ''}{i.rejected ? ` · ${i.rejected} unreadable` : ''}</span> },
        { key: 'r', header: 'Statement check', render: (i) => i.reconciliation?.status === 'reconciled' ? <Badge kind="ok">Reconciled</Badge> : i.reconciliation?.status === 'difference' ? <Badge kind="warn">Difference <Money cents={Math.abs(i.reconciliation.differenceCents ?? 0)} /></Badge> : <Badge>Not checked</Badge> },
        { key: 'x', header: '', render: (i) => (
          <span className="row">
            <button className="btn btn-sm" onClick={() => setRec({ id: i.id, opening: i.reconciliation?.openingCents ?? null, closing: i.reconciliation?.closingCents ?? null })}>Check</button>
            <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirm.ask('Undo this import?', <p>All {i.added + i.staged} transactions and balances added by “{i.fileName}” will be removed.</p>, 'Undo import', true)) { const r = await api('imports.undo', { importId: i.id }); toast(`${r.removed} transactions removed.`, 'success'); } }}>Undo</button>
          </span>) },
      ]} />
      {rec && (
        <Dialog title="Check statement balances" onClose={() => setRec(null)} footer={<><button className="btn" onClick={() => setRec(null)}>Close</button><button className="btn btn-primary" onClick={async () => { const r = await api('imports.reconcile', { importId: rec.id, openingCents: rec.opening, closingCents: rec.closing }); toast(r.message, r.status === 'reconciled' ? 'success' : 'info'); setRec(null); }}>Check</button></>}>
          <div className="form-grid">
            <MoneyField label="Opening balance on statement" cents={rec.opening} onChange={(c) => setRec({ ...rec, opening: c })} allowNegative />
            <MoneyField label="Closing balance on statement" cents={rec.closing} onChange={(c) => setRec({ ...rec, closing: c })} allowNegative />
          </div>
        </Dialog>
      )}
      {confirm.node}
    </Card>
  );
}

export function ImportScreen() {
  const { navigate, toast } = useApp();
  const { accounts } = useAccounts();
  const [session, setSession] = useState<ImportSession | null>(null);
  const [remap, setRemap] = useState(false);
  const [results, setResults] = useState<{ label: string; r: CommitResult }[] | null>(null);
  /** For a file with several accounts: which one is open for review (null = the list of accounts). */
  const [reviewing, setReviewing] = useState<{ index: number; accountId: string | null } | null>(null);
  const [done, setDone] = useState<{ label: string; r: CommitResult }[]>([]);
  const choose = useAction(async () => {
    const s = await api('imports.chooseFile');
    if (s) { setSession(s); setRemap(false); setResults(null); setReviewing(null); setDone([]); }
  });
  const needsMapping = useMemo(() => !!session && (session.needsMapping || remap), [session, remap]);
  const cancel = async () => {
    if (session) await api('imports.discard', { sessionId: session.sessionId });
    setSession(null);
    setReviewing(null);
    if (done.length) setResults(done);
  };
  const multi = !!session && session.statements.length > 1;
  /** After importing some accounts of a multi-account file: back to the list, or finished when none are left. */
  const imported = async (items: { label: string; r: CommitResult }[]) => {
    const all = [...done, ...items];
    const left = items[items.length - 1]?.r.remaining ?? 0;
    setReviewing(null);
    if (!session || left === 0) { setResults(all); setDone([]); setSession(null); return; }
    setDone(all);
    try { setSession(await api('imports.session', { sessionId: session.sessionId })); } catch { setResults(all); setDone([]); setSession(null); }
    toast(`${items.length === 1 ? items[0].label : `${items.length} accounts`} imported. ${left} account${left === 1 ? '' : 's'} still to go.`, 'success');
  };
  const totals = results && {
    added: results.reduce((a, x) => a + x.r.added, 0),
    staged: results.reduce((a, x) => a + x.r.staged, 0),
    skipped: results.reduce((a, x) => a + x.r.skippedDuplicates, 0),
    rejected: results.reduce((a, x) => a + x.r.rejectedRows, 0),
    difference: results.some((x) => x.r.reconciliation.status === 'difference'),
  };
  return (
    <Page title="Import" intro="Bring in statements and exports you downloaded yourself. Geranium never connects to your bank." actions={session ? <button className="btn" onClick={cancel}>Start again</button> : undefined}>
      {results && totals && (
        <Callout kind={totals.difference ? 'warn' : 'ok'} title="Import finished">
          {totals.added} transaction{totals.added === 1 ? '' : 's'} added{totals.staged ? `, ${totals.staged} waiting in the Review inbox` : ''}{totals.skipped ? `, ${totals.skipped} duplicates skipped` : ''}{totals.rejected ? `, ${totals.rejected} unreadable rows not imported` : ''}.{results.length === 1 && ` ${results[0].r.reconciliation.message}`}
          {results.length > 1 && (
            <ul className="small" style={{ margin: '8px 0 0' }}>
              {results.map((x) => <li key={x.r.importId}>{x.label}: {x.r.added + x.r.staged} transaction{x.r.added + x.r.staged === 1 ? '' : 's'} · {x.r.reconciliation.status === 'reconciled' ? 'reconciled with the statement' : x.r.reconciliation.message}</li>)}
            </ul>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            {totals.staged > 0 && <button className="btn btn-sm" onClick={() => navigate('inbox')}>Open Review inbox</button>}
            <button className="btn btn-sm" onClick={() => navigate('transactions')}>View transactions</button>
            <button className="btn btn-sm" onClick={() => choose.run()}>Import another file</button>
          </div>
        </Callout>
      )}
      {!session && (
        <>
          {accounts.length === 0 && <Callout kind="warn">Add an account first so imported transactions have somewhere to go. <button className="btn btn-sm" onClick={() => navigate('accounts')}>Add account</button></Callout>}
          <Card title="Choose a file">
            <div className="stack">
              <p>Supported: <strong>CSV</strong>, <strong>OFX</strong> and <strong>QFX</strong>, <strong>QIF</strong>, <strong>XLS/XLSX</strong>, and <strong>PDF statements</strong> with a text layer.</p>
              <div><button className="btn btn-primary" onClick={() => choose.run()} disabled={choose.pending}><Icon name="upload" size={16} /> Choose file…</button></div>
              <ErrorText error={choose.error} />
              <Explain label="What happens to the file?">
                {IS_WEB ? 'The file is read in this browser and is not uploaded anywhere.' : 'The file is read on this computer.'} Nothing is imported until you confirm on the review screen. Uncertain rows (low confidence, possible duplicates or transfers,
                unclear categories) wait in the Review inbox and are left out of your figures until you approve them. You can keep an encrypted copy of the original file as a source record.
                PDF statements are read from their text; scanned (image-only) PDFs cannot be read in this version.
              </Explain>
            </div>
          </Card>
          <History />
        </>
      )}
      {session && session.sheetNames.length > 1 && (
        <Card><SelectField label="Worksheet" value={session.selectedSheet ?? ''} onChange={async (v) => { try { setSession(await api('imports.chooseSheet', { sessionId: session.sessionId, sheet: v })); } catch (e) { toast((e as Error).message, 'error'); } }} options={session.sheetNames.map((n) => ({ value: n, label: n }))} /></Card>
      )}
      {session && needsMapping && <Mapping session={session} onApplied={(s) => { setSession(s); setRemap(false); }} />}
      {session && !needsMapping && (
        <>
          {session.mapping !== null && <div><button className="btn btn-sm" onClick={() => setRemap(true)}>Change which columns are used</button></div>}
          {multi && !reviewing && <AccountsInFile key={session.sessionId + done.length} session={session} onCancel={cancel} onImported={imported} onReview={(index, accountId) => setReviewing({ index, accountId })} />}
          {multi && reviewing && (
            <Review key={`${session.sessionId}:${reviewing.index}`} session={session} index={reviewing.index} initialAccountId={reviewing.accountId} onCancel={cancel} onBack={() => setReviewing(null)}
              onDone={(r) => void imported([{ label: `${statementLabel(session.statements[reviewing.index])}`, r }])} />
          )}
          {!multi && <Review key={session.sessionId + session.statements.length} session={session} index={0} onCancel={cancel} onDone={(r) => { setResults([{ label: '', r }]); setSession(null); }} />}
        </>
      )}
    </Page>
  );
}
