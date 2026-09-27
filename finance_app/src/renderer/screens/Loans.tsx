import { useEffect, useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { Badge, Callout, Card, DataTable, DateField, DateText, Dialog, Empty, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, TextField, useConfirm } from '../components/ui';
import { LineChart } from '../components/charts';
import { AccountSelect, todayLocal } from '../components/pickers';
import { FREQUENCY_LABEL } from '@domain/periods';
import { addMonths } from '@domain/dates';
import type { ApiOutput } from '../../main/api';

type Loan = ApiOutput<'loans.list'>[number];
const KIND_LABEL: Record<Loan['kind'], string> = { mortgage: 'Mortgage', 'personal-loan': 'Personal loan', 'car-loan': 'Car loan', 'credit-card': 'Credit card', 'other-debt': 'Other debt' };

function LoanForm({ initial, onClose }: { initial?: Loan; onClose: () => void }) {
  const [l, setL] = useState<Omit<Loan, 'id'> & { id?: string }>(initial ?? { accountId: null, name: 'Home loan', kind: 'mortgage', balanceCents: 0, ratePercent: 6, repaymentCents: null, frequency: 'monthly', remainingTermMonths: 300, offsetAccountId: null, extraRepaymentCents: 0, asOf: todayLocal(), rateChanges: [], notes: null });
  const save = useAction(async () => { await api('loans.save', l as never); onClose(); });
  return (
    <Dialog title={initial ? 'Edit loan' : 'Add a loan or debt'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Name" value={l.name} onChange={(v) => setL({ ...l, name: v })} />
        <SelectField label="Kind" value={l.kind} onChange={(v) => setL({ ...l, kind: v })} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value: value as Loan['kind'], label }))} />
        <MoneyField label="Balance owed" cents={l.balanceCents || null} onChange={(c) => setL({ ...l, balanceCents: c ?? 0 })} />
        <DateField label="Balance as at" value={l.asOf} onChange={(v) => v && setL({ ...l, asOf: v })} />
        <NumberField label="Interest rate" suffix="% a year" value={l.ratePercent} onChange={(v) => setL({ ...l, ratePercent: v ?? 0 })} />
        <SelectField label="Repayments" value={l.frequency} onChange={(v) => setL({ ...l, frequency: v })} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} />
        <MoneyField label="Repayment amount (optional)" cents={l.repaymentCents} onChange={(c) => setL({ ...l, repaymentCents: c })} hint="Leave blank to use the minimum for the remaining term." />
        <NumberField label="Remaining term" suffix="months" value={l.remainingTermMonths} step="1" onChange={(v) => setL({ ...l, remainingTermMonths: v === null ? null : Math.round(v) })} />
        <MoneyField label="Extra repayment each time" cents={l.extraRepaymentCents} onChange={(c) => setL({ ...l, extraRepaymentCents: c ?? 0 })} />
        <AccountSelect label="Linked account (optional)" value={l.accountId} onChange={(v) => setL({ ...l, accountId: v })} allowNone types={['mortgage', 'personal-loan', 'car-loan', 'credit-card', 'other-debt', 'other-liability']} />
        {l.kind === 'mortgage' && <AccountSelect label="Offset account (optional)" value={l.offsetAccountId} onChange={(v) => setL({ ...l, offsetAccountId: v })} allowNone types={['offset', 'savings', 'transaction', 'high-interest-savings']} />}
      </div>
      <ErrorText error={save.error} />
    </Dialog>
  );
}

function LoanModel({ loan }: { loan: Loan }) {
  const [extra, setExtra] = useState<number | null>(loan.extraRepaymentCents || null);
  const [offset, setOffset] = useState<number | null>(null);
  const [offsetChange, setOffsetChange] = useState<number | null>(null);
  const [lump, setLump] = useState<{ date: string | null; amount: number | null }>({ date: addMonths(todayLocal(), 6), amount: null });
  const [rate, setRate] = useState<{ date: string | null; rate: number | null }>({ date: addMonths(todayLocal(), 1), rate: null });
  const [model, setModel] = useState<ApiOutput<'loans.model'> | null>(null);
  const run = useAction(async () => setModel(await api('loans.model', {
    id: loan.id, extraRepaymentCents: extra ?? 0, offsetCents: offset, offsetMonthlyChangeCents: offsetChange ?? undefined,
    lumpSums: lump.date && lump.amount ? [{ date: lump.date, amountCents: lump.amount }] : [],
    rateChanges: rate.date && rate.rate !== null ? [{ date: rate.date, annualRatePercent: rate.rate }] : undefined,
  })));
  useEffect(() => { void run.run(); }, [loan.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = model?.result;
  return (
    <div className="stack-lg">
      <Card title="What if…" sub="Try different assumptions. Your saved loan details are not changed.">
        <div className="form-grid">
          <MoneyField label="Extra repayment each time" cents={extra} onChange={setExtra} />
          {loan.kind === 'mortgage' && <MoneyField label="Offset balance" cents={offset} onChange={setOffset} hint={model?.offsetSource ? `Now: ${model.offsetSource}` : 'Blank uses the linked offset account'} />}
          {loan.kind === 'mortgage' && <MoneyField label="Offset grows each month by" cents={offsetChange} onChange={setOffsetChange} allowNegative />}
          <DateField label="Lump sum on" value={lump.date} onChange={(v) => setLump({ ...lump, date: v })} />
          <MoneyField label="Lump sum amount" cents={lump.amount} onChange={(c) => setLump({ ...lump, amount: c })} />
          <DateField label="Rate changes on" value={rate.date} onChange={(v) => setRate({ ...rate, date: v })} />
          <NumberField label="New rate" suffix="% a year" value={rate.rate} onChange={(v) => setRate({ ...rate, rate: v })} />
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={() => run.run()}>Recalculate</button></div>
        <ErrorText error={run.error} />
      </Card>
      {model?.staleNote && <Callout kind="warn">{model.staleNote}</Callout>}
      {r && (
        <Card title="Under these assumptions">
          <div className="stack">
            <Callout kind={r.neverRepaid ? 'warn' : 'neutral'}>{r.explanation}</Callout>
            <div className="grid grid-4">
              <Stat label="Repayment" value={<Money cents={r.repaymentCents} />} note={FREQUENCY_LABEL[loan.frequency]} />
              <Stat label="Estimated payoff" value={r.payoffDate ? <DateText date={r.payoffDate} /> : '—'} note={r.months ? `${Math.floor(r.months / 12)} years ${r.months % 12} months` : undefined} />
              <Stat label="Estimated total interest" value={<Money cents={r.totalInterestCents} />} />
              <Stat label="Principal reduction in year 1" value={<Money cents={r.years[0]?.principalCents ?? 0} />} note={r.years[0] ? <>Interest year 1: <Money cents={r.years[0].interestCents} /></> : undefined} />
            </div>
            {model!.offsetEffect && <Callout kind="neutral">{model!.offsetEffect.explanation}</Callout>}
            <LineChart title="Projected loan balance" series={[{ name: 'Balance', points: r.monthlyBalances.filter((_, i) => i % 3 === 0).map((p) => ({ date: p.date, value: p.balanceCents })) }]} summary={r.explanation} />
            <h3>Compared with…</h3>
            <ul>{model!.comparisons.map((c) => c && <li key={c.label}><strong>{c.label}:</strong> {c.sentence}</li>)}</ul>
            <DataTable rows={r.years} rowKey={(y) => String(y.year)} maxHeight={320} columns={[
              { key: 'y', header: 'Year', render: (y) => y.year },
              { key: 'e', header: 'Ending', render: (y) => <DateText date={y.endDate} /> },
              { key: 'o', header: 'Opening', num: true, render: (y) => <Money cents={y.openingCents} /> },
              { key: 'i', header: 'Interest', num: true, render: (y) => <Money cents={y.interestCents} /> },
              { key: 'p', header: 'Principal reduction', num: true, render: (y) => <Money cents={y.principalCents} /> },
              { key: 'c', header: 'Closing', num: true, render: (y) => <Money cents={y.closingCents} /> },
            ]} />
            <Explain><ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul><p>Future interest rates are not predicted. Results show what the arithmetic gives if the assumptions hold.</p></Explain>
          </div>
        </Card>
      )}
    </div>
  );
}

function Debts() {
  const [order, setOrder] = useState<'as-listed' | 'highest-rate-first' | 'smallest-balance-first'>('as-listed');
  const [extra, setExtra] = useState<number | null>(null);
  const q = useApi('loans.debts', { order, extraMonthlyCents: extra ?? 0 }, [order, extra]);
  if (!q.data || !q.data.debts.length) return null;
  const r = q.data.result;
  return (
    <Card title="Paying off other debts" sub="A mathematical model of your cards and loans. Choose any order — none is recommended.">
      <div className="form-grid">
        <SelectField label="Extra money goes to" value={order} onChange={setOrder} options={[{ value: 'as-listed', label: 'Debts in the order listed' }, { value: 'highest-rate-first', label: 'Highest interest rate first' }, { value: 'smallest-balance-first', label: 'Smallest balance first' }]} />
        <MoneyField label="Extra each month" cents={extra} onChange={setExtra} />
      </div>
      <DataTable rows={r.debts} rowKey={(d) => d.id} columns={[
        { key: 'n', header: 'Debt', render: (d) => d.name },
        { key: 'p', header: 'Estimated payoff', render: (d) => (d.neverRepaid ? <Badge kind="warn">Not repaid at this payment</Badge> : <DateText date={d.payoffDate} />) },
        { key: 'i', header: 'Estimated interest', num: true, render: (d) => <Money cents={d.totalInterestCents} /> },
      ]} />
      <p className="small muted" style={{ marginTop: 8 }}>{r.explanation} Total estimated interest: <Money cents={r.totalInterestCents} />.</p>
    </Card>
  );
}

export function Loans() {
  const q = useApi('loans.list', undefined, []);
  const [edit, setEdit] = useState<Loan | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!q.data) return <Loading />;
  const current = q.data.find((l) => l.id === selected) ?? q.data[0];
  return (
    <Page title="Mortgage & debts" intro="Model repayments, offset accounts, extra repayments and rate changes. Every result is under the assumptions shown." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}>Add loan</button>}>
      {!q.data.length ? <Card><Empty title="No loans entered" action={<button className="btn btn-primary" onClick={() => setEdit('new')}>Add a loan</button>}>Add your mortgage, car loan or other debts to model payoff dates and interest.</Empty></Card> : (
        <>
          <Card>
            <div className="row-between">
              <SelectField label="Loan" value={current.id} onChange={setSelected} options={q.data.map((l) => ({ value: l.id, label: `${l.name} (${KIND_LABEL[l.kind]})` }))} />
              <span className="row"><span className="muted small"><Money cents={current.balanceCents} /> at {current.ratePercent}% as at <DateText date={current.asOf} /></span>
                <button className="btn btn-sm" onClick={() => setEdit(current)}>Edit details</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm.ask('Delete loan?', <p>Delete the details for “{current.name}”?</p>, 'Delete', true)) await api('loans.delete', { id: current.id }); }}>Delete</button></span>
            </div>
          </Card>
          <LoanModel key={current.id + current.balanceCents + current.ratePercent} loan={current} />
          <Debts />
        </>
      )}
      {edit && <LoanForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {confirm.node}
    </Page>
  );
}
