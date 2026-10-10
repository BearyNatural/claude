import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Card, Checkbox, DataTable, DateField, DateText, Dialog, Drawer, ErrorText, Explain, Freshness, Loading, Money, MoneyField, NumberField, Page, SelectField, TextField, useConfirm } from '../components/ui';
import { AccountSelect, todayLocal } from '../components/pickers';
import { ACCOUNT_TYPE_LABEL, AccountType, VALUE_SOURCE_LABEL, isLiability } from '@domain/accounts';
import type { AccountDTO } from '../../shared/types';

function AccountForm({ initial, onSaved, onCancel }: { initial?: AccountDTO; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AccountType>(initial?.type ?? 'transaction');
  const [institution, setInstitution] = useState(initial?.institution ?? '');
  const [number, setNumber] = useState('');
  const [removeNumber, setRemoveNumber] = useState(false);
  const [status, setStatus] = useState<AccountDTO['status']>(initial?.status ?? 'active');
  const [rate, setRate] = useState<number | null>(initial?.interestRate ?? null);
  const [limit, setLimit] = useState<number | null>(initial?.creditLimitCents ?? null);
  const [linked, setLinked] = useState<string | null>(initial?.linkedAccountId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceDate, setBalanceDate] = useState<string | null>(todayLocal());
  const save = useAction(async () => {
    await api('accounts.save', {
      id: initial?.id, name, type, institution: institution || null, number: removeNumber ? null : number || undefined, status, interestRate: rate, creditLimitCents: limit, linkedAccountId: linked, notes: notes || null,
      openingBalance: !initial && balance !== null && balanceDate ? { date: balanceDate, balanceCents: isLiability(type) ? -Math.abs(balance) : balance, source: ['property', 'vehicle', 'other-asset'].includes(type) ? 'estimated' : 'manual' } : null,
    });
    onSaved();
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} required autoFocus />
        <SelectField label="Type" value={type} onChange={setType} options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value: value as AccountType, label }))} />
        <TextField label="Institution" value={institution} onChange={setInstitution} />
        <div className="stack-sm">
          <TextField label={initial?.numberMasked ? `Account number (stored as ${initial.numberMasked})` : 'Account number (optional)'} value={removeNumber ? '' : number} onChange={setNumber} hint={initial?.numberMasked ? 'Leave blank to keep it, type a new one to replace it. Only the last 4 digits are kept.' : 'Only the last 4 digits are kept, to recognise statements.'} />
          {initial?.numberMasked && <Checkbox label="Remove the stored account number" checked={removeNumber} onChange={setRemoveNumber} />}
        </div>
        {initial && <SelectField label="Status" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived (hidden)' }]} />}
        {['savings', 'high-interest-savings', 'offset', 'term-deposit', 'mortgage', 'personal-loan', 'car-loan', 'credit-card'].includes(type) && <NumberField label="Interest rate" suffix="% p.a." value={rate} onChange={setRate} />}
        {type === 'credit-card' && <MoneyField label="Credit limit" cents={limit} onChange={setLimit} />}
        {type === 'offset' && <AccountSelect label="Offsets this loan account" value={linked} onChange={setLinked} allowNone types={['mortgage']} />}
        {!initial && <MoneyField label={isLiability(type) ? 'Amount owed (optional)' : ['property', 'vehicle', 'other-asset'].includes(type) ? 'Estimated value (optional)' : 'Balance (optional)'} cents={balance} onChange={setBalance} />}
        {!initial && <DateField label="As at" value={balanceDate} onChange={setBalanceDate} />}
      </div>
      <TextField label="Notes" value={notes} onChange={setNotes} />
      <ErrorText error={save.error} />
      <div className="form-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={save.pending || !name.trim()}>Save</button></div>
    </form>
  );
}

function AccountDrawer({ account, onClose }: { account: AccountDTO; onClose: () => void }) {
  const { navigate, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const balances = useApi('accounts.balances', { accountId: account.id }, [account.id]);
  const [bal, setBal] = useState<number | null>(null);
  const [balDate, setBalDate] = useState<string | null>(todayLocal());
  const [src, setSrc] = useState<'manual' | 'estimated'>(['property', 'vehicle', 'other-asset'].includes(account.type) ? 'estimated' : 'manual');
  const confirm = useConfirm();
  const liability = isLiability(account.type);
  const addBal = useAction(async () => {
    if (bal === null || !balDate) return;
    await api('accounts.addBalance', { accountId: account.id, date: balDate, balanceCents: liability ? -Math.abs(bal) : bal, source: src, note: null });
    setBal(null);
    balances.reload();
  });
  return (
    <Drawer title={account.name} onClose={onClose}>
      {editing ? <AccountForm initial={account} onSaved={() => { setEditing(false); onClose(); }} onCancel={() => setEditing(false)} /> : (
        <div className="stack-lg">
          <dl className="kv">
            <dt>Type</dt><dd>{ACCOUNT_TYPE_LABEL[account.type]}</dd>
            <dt>Institution</dt><dd>{account.institution ?? '—'}</dd>
            <dt>Account</dt><dd>{account.numberMasked ?? '—'}</dd>
            <dt>Status</dt><dd>{account.status}</dd>
            <dt>Transactions</dt><dd>{account.transactionCount}</dd>
            <dt>Last statement</dt><dd>{account.lastStatementEnd ? <DateText date={account.lastStatementEnd} /> : '—'}</dd>
          </dl>
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" onClick={() => navigate('transactions', { accountId: account.id })}>View transactions</button>
            <button className="btn" onClick={() => navigate('import')}>Import statement</button>
          </div>
          <Card title="Balance history" sub="Every value is labelled with how it is known and its date">
            {balances.data?.length ? (
              <DataTable rows={balances.data} rowKey={(b) => b.id} maxHeight={280} columns={[
                { key: 'd', header: 'Date', render: (b) => <DateText date={b.date} /> },
                { key: 'b', header: liability ? 'Owed' : 'Balance', num: true, render: (b) => <Money cents={liability ? Math.abs(b.balanceCents) : b.balanceCents} /> },
                { key: 's', header: 'Source', render: (b) => <Badge kind="outline">{VALUE_SOURCE_LABEL[b.source as keyof typeof VALUE_SOURCE_LABEL] ?? b.source}</Badge> },
                { key: 'x', header: '', render: (b) => (b.source === 'manual' || b.source === 'estimated') ? <button className="btn btn-ghost btn-sm" onClick={async () => { await api('accounts.deleteBalance', { id: b.id }); balances.reload(); }}>Remove</button> : null },
              ]} />
            ) : <p className="muted">No balances recorded.</p>}
            <div className="form-grid" style={{ marginTop: 12 }}>
              <MoneyField label={liability ? 'Amount owed' : 'Balance or value'} cents={bal} onChange={setBal} />
              <DateField label="As at" value={balDate} onChange={setBalDate} />
              <SelectField label="How it is known" value={src} onChange={setSrc} options={[{ value: 'manual', label: 'Entered from a statement or app' }, { value: 'estimated', label: 'My estimate' }]} />
            </div>
            <ErrorText error={addBal.error} />
            <div className="form-actions"><button className="btn" disabled={bal === null} onClick={() => addBal.run()}>Add balance</button></div>
          </Card>
          <div className="row">
            <button className="btn btn-danger" onClick={async () => {
              if (!(await confirm.ask('Delete account?', account.transactionCount ? <p>This account has transactions, so it can only be closed or archived — its history is kept.</p> : <p>Delete “{account.name}” and its balances? This cannot be undone.</p>, account.transactionCount ? 'OK' : 'Delete', true))) return;
              if (account.transactionCount) return;
              try { await api('accounts.delete', { id: account.id }); onClose(); } catch (e) { toast((e as Error).message, 'error'); }
            }}>Delete account</button>
          </div>
        </div>
      )}
      {confirm.node}
    </Drawer>
  );
}

export function Accounts() {
  const q = useApi('accounts.list', undefined, []);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const today = todayLocal();
  if (!q.data) return <Loading />;
  const groups: { title: string; filter: (a: AccountDTO) => boolean }[] = [
    { title: 'Cash accounts', filter: (a) => ['transaction', 'savings', 'high-interest-savings', 'offset', 'cash', 'brokerage-cash'].includes(a.type) },
    { title: 'Cards and loans', filter: (a) => isLiability(a.type) },
    { title: 'Investments, super and term deposits', filter: (a) => ['brokerage', 'superannuation', 'term-deposit'].includes(a.type) },
    { title: 'Other assets', filter: (a) => ['property', 'vehicle', 'other-asset'].includes(a.type) },
  ];
  const openAcc = q.data.find((a) => a.id === open);
  return (
    <Page title="Accounts" intro="Balances come from imported statements, values you enter, or a statement balance plus later imported transactions. None of them are live." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add account</button>}>
      {groups.map((g) => {
        const rows = q.data!.filter((a) => g.filter(a) && a.status !== 'archived');
        if (!rows.length) return null;
        return (
          <Card key={g.title} title={g.title}>
            <DataTable rows={rows} rowKey={(a) => a.id} onRowClick={(a) => setOpen(a.id)} columns={[
              { key: 'n', header: 'Account', sort: (a) => a.name, render: (a) => <span>{a.name} {a.status === 'closed' && <Badge>Closed</Badge>}<div className="muted small">{ACCOUNT_TYPE_LABEL[a.type]}{a.institution ? ` · ${a.institution}` : ''}{a.numberMasked ? ` · ${a.numberMasked}` : ''}</div></span> },
              { key: 'f', header: 'How current', render: (a) => (a.balance ? <Freshness date={a.balance.date} source={VALUE_SOURCE_LABEL[a.balance.source]} today={today} /> : <span className="muted small">No balance yet</span>) },
              { key: 'b', header: isLiability(rows[0].type) ? 'Owed' : 'Balance', num: true, sort: (a) => a.balance?.balanceCents ?? 0, render: (a) => (a.balance ? <Money cents={isLiability(a.type) ? Math.abs(a.balance.balanceCents) : a.balance.balanceCents} /> : '—') },
            ]} />
          </Card>
        );
      })}
      {q.data.some((a) => a.status === 'archived') && (
        <Card title="Archived"><ul className="list-plain">{q.data.filter((a) => a.status === 'archived').map((a) => <li key={a.id}><button className="btn btn-ghost btn-sm" onClick={() => setOpen(a.id)}>{a.name}</button></li>)}</ul></Card>
      )}
      <Explain label="How are balances worked out?">
        An <strong>imported balance</strong> is a closing or running balance printed on a statement you imported. A <strong>calculated balance</strong> is the latest statement balance plus
        transactions imported after it, dated at the last of those transactions. <strong>Entered</strong> and <strong>estimated</strong> values are ones you typed in. Balances older than a month are marked “Not current”.
      </Explain>
      {adding && <Dialog title="Add account" onClose={() => setAdding(false)} wide><AccountForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} /></Dialog>}
      {openAcc && <AccountDrawer account={openAcc} onClose={() => setOpen(null)} />}
    </Page>
  );
}
