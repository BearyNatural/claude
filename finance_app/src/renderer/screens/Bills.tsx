import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, Empty, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, TextField, useConfirm } from '../components/ui';
import { Meter } from '../components/charts';
import { AccountSelect, CategorySelect, todayLocal } from '../components/pickers';
import { FREQUENCY_LABEL, Frequency, PERIODS_PER_YEAR } from '@domain/periods';
import { diffDays, addMonths } from '@domain/dates';
import type { BillDTO } from '../../shared/types';
import type { ApiOutput } from '../../main/api';

function BillForm({ initial, onClose }: { initial?: BillDTO; onClose: () => void }) {
  const [b, setB] = useState<Omit<BillDTO, 'id'> & { id?: string }>(initial ?? { name: '', amountCents: 0, frequency: 'monthly', nextDue: todayLocal(), categoryId: null, accountId: null, autoPay: false, reminderDays: 3, reminderEnabled: true, active: true, matchText: null, notes: null });
  const save = useAction(async () => { await api('bills.save', b as never); onClose(); });
  const set = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) => setB({ ...b, [k]: v });
  return (
    <Dialog title={initial ? 'Edit bill' : 'Add a bill'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Bill" value={b.name} onChange={(v) => set('name', v)} autoFocus />
        <MoneyField label="Expected amount" cents={b.amountCents || null} onChange={(c) => set('amountCents', c ?? 0)} />
        <SelectField label="How often" value={b.frequency} onChange={(v) => set('frequency', v)} options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value: value as Frequency, label }))} />
        <DateField label="Next due" value={b.nextDue} onChange={(v) => v && set('nextDue', v)} />
        <CategorySelect value={b.categoryId} onChange={(v) => set('categoryId', v)} kinds={['expense']} />
        <AccountSelect label="Usually paid from" value={b.accountId} onChange={(v) => set('accountId', v)} allowNone />
        <TextField label="Text on the bank statement (optional)" value={b.matchText ?? ''} onChange={(v) => set('matchText', v || null)} hint="Helps spot when it has been paid, e.g. AGL" />
        <NumberField label="Remind me" suffix="days before" value={b.reminderDays} min={0} max={90} step="1" onChange={(v) => set('reminderDays', Math.max(0, Math.round(v ?? 0)))} />
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <Checkbox label="Paid automatically (direct debit)" checked={b.autoPay} onChange={(v) => set('autoPay', v)} />
        <Checkbox label="Reminders for this bill" checked={b.reminderEnabled} onChange={(v) => set('reminderEnabled', v)} />
        <Checkbox label="Active" checked={b.active} onChange={(v) => set('active', v)} />
      </div>
      <ErrorText error={save.error} />
    </Dialog>
  );
}

type Fund = ApiOutput<'sinking.list'>[number];

function FundForm({ initial, onClose }: { initial?: Fund; onClose: () => void }) {
  const [f, setF] = useState({ id: initial?.id ?? '', name: initial?.name ?? '', targetCents: initial?.targetCents ?? 0, savedCents: initial?.savedCents ?? 0, dueDate: initial?.dueDate ?? addMonths(todayLocal(), 6), categoryId: initial?.categoryId ?? null, repeat: (initial?.repeat ?? null) as Frequency | null, notes: initial?.notes ?? null });
  const save = useAction(async () => { await api('sinking.save', f); onClose(); });
  return (
    <Dialog title={initial ? 'Edit sinking fund' : 'Plan for an irregular expense'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Expense" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="e.g. Car registration" />
        <MoneyField label="Amount needed" cents={f.targetCents || null} onChange={(c) => setF({ ...f, targetCents: c ?? 0 })} />
        <MoneyField label="Already set aside" cents={f.savedCents} onChange={(c) => setF({ ...f, savedCents: c ?? 0 })} />
        <DateField label="Needed by" value={f.dueDate} onChange={(v) => v && setF({ ...f, dueDate: v })} />
        <SelectField label="Repeats" value={f.repeat ?? ''} placeholder="Once" onChange={(v) => setF({ ...f, repeat: (v || null) as Frequency | null })} options={[{ value: 'annually' as Frequency, label: 'Every year' }, { value: 'six-monthly' as Frequency, label: 'Every six months' }, { value: 'quarterly' as Frequency, label: 'Every quarter' }]} />
        <CategorySelect value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} kinds={['expense']} />
      </div>
      <ErrorText error={save.error} />
    </Dialog>
  );
}

export function Bills() {
  const { toast } = useApp();
  const today = todayLocal();
  const bills = useApi('bills.list', undefined, []);
  const funds = useApi('sinking.list', undefined, []);
  const [editBill, setEditBill] = useState<BillDTO | 'new' | null>(null);
  const [editFund, setEditFund] = useState<Fund | 'new' | null>(null);
  const confirm = useConfirm();
  if (!bills.data || !funds.data) return <Loading />;
  const active = bills.data.filter((b) => b.active);
  const annual = active.reduce((a, b) => a + b.amountCents * PERIODS_PER_YEAR[b.frequency], 0);
  return (
    <Page title="Bills & sinking funds" intro="Bills you expect, and money to set aside for irregular costs. Amounts to set aside are arithmetic, not recommendations.">
      <Card title="Bills" actions={<button className="btn btn-primary btn-sm" onClick={() => setEditBill('new')}>Add bill</button>}>
        {!bills.data.length ? <Empty title="No bills yet">Add regular bills to see them in the calendar, forecasts and reminders.</Empty> : (
          <div className="stack">
            <div className="grid grid-4">
              <Stat label="Bills per year" value={<Money cents={Math.round(annual)} />} />
              <Stat label="Spread per month" value={<Money cents={Math.round(annual / 12)} />} />
              <Stat label="Spread per fortnight" value={<Money cents={Math.round(annual / 26)} />} />
              <Stat label="Spread per week" value={<Money cents={Math.round(annual / 52)} />} />
            </div>
            <DataTable rows={bills.data} rowKey={(b) => b.id} onRowClick={(b) => setEditBill(b)} columns={[
              { key: 'n', header: 'Bill', sort: (b) => b.name, render: (b) => <span>{b.name} {!b.active && <Badge>Inactive</Badge>} {b.autoPay && <Badge kind="outline">Automatic</Badge>}</span> },
              { key: 'a', header: 'Amount', num: true, render: (b) => <Money cents={b.amountCents} /> },
              { key: 'f', header: 'How often', render: (b) => FREQUENCY_LABEL[b.frequency] },
              { key: 'd', header: 'Next due', sort: (b) => b.nextDue, render: (b) => { const n = diffDays(today, b.nextDue); return <span><DateText date={b.nextDue} /><div className="small muted">{n < 0 ? <Badge kind="warn">{-n} days overdue</Badge> : n === 0 ? 'today' : `in ${n} days`}</div></span>; } },
              { key: 'y', header: 'Per year', num: true, render: (b) => <Money cents={b.amountCents * PERIODS_PER_YEAR[b.frequency]} /> },
              { key: 'p', header: '', render: (b) => (
                <span className="row" onClick={(e) => e.stopPropagation()}>
                  {b.suggestedPayment && <Badge kind="ok">Paid? <Money cents={b.suggestedPayment.amountCents} /> on <DateText date={b.suggestedPayment.date} /></Badge>}
                  <button className="btn btn-sm" onClick={async () => { const r = await api('bills.markPaid', { id: b.id, transactionId: b.suggestedPayment?.id ?? null }); toast(`${b.name} marked paid. Next due ${r.nextDue}.`, 'success'); }}>Mark paid</button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm.ask('Delete bill?', <p>Delete “{b.name}”?</p>, 'Delete', true)) await api('bills.delete', { id: b.id }); }}>Delete</button>
                </span>) },
            ]} />
            <Explain>Per-week, per-fortnight and per-month figures spread each bill’s yearly cost evenly (yearly cost ÷ 52, 26 or 12). A bill is shown as possibly paid when a transaction within a week of the due date has a similar amount (within 10%) and matching text.</Explain>
          </div>
        )}
      </Card>
      <Card title="Sinking funds" sub="How much to set aside to have an irregular expense covered by its date" actions={<button className="btn btn-primary btn-sm" onClick={() => setEditFund('new')}>Add</button>}>
        {!funds.data.length ? <p className="muted">Nothing planned yet — for example car registration, insurance, Christmas or school costs.</p> : (
          <div className="grid grid-3">
            {funds.data.map((f) => (
              <div key={f.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="row-between"><strong>{f.name}</strong><button className="btn btn-ghost btn-sm" onClick={() => setEditFund(f)}>Edit</button></div>
                <div className="small muted">Needed by <DateText date={f.dueDate} />{f.repeat ? ` · repeats ${FREQUENCY_LABEL[f.repeat].toLowerCase()}` : ''}</div>
                <div style={{ margin: '8px 0' }}><Meter value={f.savedCents} max={f.targetCents} label={`${f.name} set aside`} /></div>
                <div className="small"><Money cents={f.savedCents} /> of <Money cents={f.targetCents} /> set aside</div>
                {f.plan.remainingCents > 0 ? (
                  <dl className="kv small" style={{ marginTop: 8 }}>
                    <dt>Per week</dt><dd><Money cents={f.plan.perWeekCents} /></dd>
                    <dt>Per fortnight</dt><dd><Money cents={f.plan.perFortnightCents} /></dd>
                    <dt>Per month</dt><dd><Money cents={f.plan.perMonthCents} /></dd>
                  </dl>
                ) : <Callout kind="ok">Fully set aside.</Callout>}
                <p className="muted small" style={{ marginTop: 6 }}>{f.plan.explanation}</p>
                <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => api('sinking.complete', { id: f.id })}>{f.repeat ? 'Paid — start the next one' : 'Paid — remove'}</button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {editBill && <BillForm initial={editBill === 'new' ? undefined : editBill} onClose={() => setEditBill(null)} />}
      {editFund && <FundForm initial={editFund === 'new' ? undefined : editFund} onClose={() => setEditFund(null)} />}
      {confirm.node}
    </Page>
  );
}
