import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { Badge, Callout, Card, DataTable, Dialog, Empty, ErrorText, Explain, Loading, Money, MoneyField, Page, Segmented, SelectField, TextField, useConfirm } from '../components/ui';
import { ColumnChart } from '../components/charts';
import { CategorySelect, RangePicker, RangePreset, presetRange, todayLocal, useCategories } from '../components/pickers';
import { FREQUENCY_LABEL, Frequency, PeriodKind, PERIOD_KIND_LABEL } from '@domain/periods';
import { addDays, addMonths } from '@domain/dates';
import type { ApiOutput } from '../../main/api';

type Budget = ApiOutput<'budgets.list'>[number];

function BudgetEditor({ initial, onClose }: { initial?: Budget; onClose: () => void }) {
  const today = todayLocal();
  const { byId } = useCategories();
  const [name, setName] = useState(initial?.name ?? 'Household budget');
  const [method, setMethod] = useState<'historical' | 'manual' | 'hybrid'>(initial?.method ?? 'hybrid');
  const [frequency, setFreq] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [preset, setPreset] = useState<RangePreset>('last-3-months');
  const [custom, setCustom] = useState({ start: addMonths(today, -6), end: today });
  const [level, setLevel] = useState<'top' | 'leaf'>('leaf');
  const [lines, setLines] = useState<{ categoryId: string; amountCents: number; basisCents?: number | null }[]>(initial?.lines ?? []);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [addCat, setAddCat] = useState<string | null>(null);
  const basis = presetRange(preset, today, custom);
  const propose = useAction(async () => {
    const p = await api('budgets.propose', { frequency, basis: { start: basis.start, end: basis.end }, level });
    setLines(p.lines.map((l) => ({ categoryId: l.categoryId, amountCents: l.amountCents, basisCents: l.basisCents })));
    setExplanation(p.explanation);
  });
  const save = useAction(async () => {
    await api('budgets.save', { id: initial?.id, name, method, frequency, basisStart: method === 'manual' ? null : basis.start, basisEnd: method === 'manual' ? null : basis.end, lines: lines.map((l) => ({ categoryId: l.categoryId, amountCents: l.amountCents, basisCents: l.basisCents ?? null })) });
    onClose();
  });
  const total = lines.reduce((a, l) => a + l.amountCents, 0);
  return (
    <Dialog title={initial ? 'Edit budget' : 'New budget'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!lines.length || save.pending} onClick={() => save.run()}>Save budget</button></>}>
      <div className="stack-lg">
        <div className="form-grid">
          <TextField label="Name" value={name} onChange={setName} />
          <SelectField label="Method" value={method} onChange={setMethod} options={[{ value: 'historical', label: 'Historical — from actual spending' }, { value: 'hybrid', label: 'Hybrid — history as a starting point' }, { value: 'manual', label: 'Manual — enter every amount' }]} />
          <SelectField label="Budget period" value={frequency} onChange={setFreq} options={(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'] as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
        </div>
        {method !== 'manual' && (
          <Card title="Start from history">
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
              <Segmented label="Detail" value={level} onChange={setLevel} options={[{ value: 'leaf', label: 'Categories' }, { value: 'top', label: 'Groups' }]} />
              <button className="btn" onClick={() => propose.run()}>Suggest amounts</button>
            </div>
            {explanation && <p className="muted small" style={{ marginTop: 8 }}>{explanation}</p>}
            <ErrorText error={propose.error} />
          </Card>
        )}
        <DataTable rows={lines} rowKey={(l) => l.categoryId} empty={<p className="muted">No lines yet. {method === 'manual' ? 'Add categories below.' : 'Suggest amounts from history, then adjust.'}</p>} columns={[
          { key: 'c', header: 'Category', render: (l) => byId.get(l.categoryId)?.path ?? l.categoryId },
          { key: 'h', header: 'Historical average', num: true, render: (l) => (l.basisCents != null ? <Money cents={l.basisCents} /> : '—') },
          { key: 'a', header: `Allocated ${FREQUENCY_LABEL[frequency].toLowerCase()}`, render: (l) => <div style={{ maxWidth: 160 }}><MoneyField label="Amount" cents={l.amountCents} onChange={(c) => setLines(lines.map((x) => (x.categoryId === l.categoryId ? { ...x, amountCents: c ?? 0 } : x)))} /></div> },
          { key: 'x', header: '', render: (l) => <button className="btn btn-ghost btn-sm" onClick={() => setLines(lines.filter((x) => x.categoryId !== l.categoryId))}>Remove</button> },
        ]} />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 280 }}><CategorySelect label="Add a category" value={addCat} onChange={setAddCat} kinds={['expense', 'savings', 'investment']} /></div>
          <button className="btn" disabled={!addCat || lines.some((l) => l.categoryId === addCat)} onClick={() => { setLines([...lines, { categoryId: addCat!, amountCents: 0 }]); setAddCat(null); }}>Add</button>
          <span className="muted">Total <Money cents={total} /> {FREQUENCY_LABEL[frequency].toLowerCase()}</span>
        </div>
        <ErrorText error={save.error} />
      </div>
    </Dialog>
  );
}

function Report({ budget }: { budget: Budget }) {
  const today = todayLocal();
  const natural: PeriodKind = ({ weekly: 'week', fortnightly: 'fortnight', monthly: 'month', quarterly: 'quarter', annually: 'financial-year' } as Record<string, PeriodKind>)[budget.frequency] ?? 'month';
  const [kind, setKind] = useState<PeriodKind>(natural);
  const [anchor, setAnchor] = useState(today);
  const q = useApi('budgets.report', { budgetId: budget.id, kind, anchor }, [budget.id, kind, anchor]);
  const step = (dir: 1 | -1) => {
    if (!q.data) return;
    setAnchor(dir === -1 ? addDays(q.data.period.start, -1) : addDays(q.data.period.end, 1));
  };
  return (
    <Card title={q.data?.period.label ?? 'Budget vs actual'} sub={q.data?.elapsedFraction != null ? `In progress: ${Math.round(q.data.elapsedFraction * 100)}% of the period has passed` : undefined}
      actions={<>
        <Segmented label="View by" value={kind} onChange={setKind} options={(['week', 'fortnight', 'month', 'quarter'] as PeriodKind[]).map((k) => ({ value: k, label: PERIOD_KIND_LABEL[k] }))} />
        <button className="btn btn-sm" onClick={() => step(-1)} aria-label="Previous period">←</button>
        <button className="btn btn-sm" onClick={() => setAnchor(today)}>Current</button>
        <button className="btn btn-sm" onClick={() => step(1)} aria-label="Next period">→</button>
      </>}>
      {!q.data ? <Loading /> : (
        <div className="stack-lg">
          {q.data.note && <Callout kind="neutral">{q.data.note}</Callout>}
          <ColumnChart title="Allocated and actual by category" series={['Allocated', 'Actual']} data={q.data.rows.filter((r) => r.inBudget).sort((a, b) => b.budgetCents - a.budgetCents).slice(0, 10).map((r) => ({ label: r.name, values: [r.budgetCents, r.actualCents] }))} />
          <DataTable rows={q.data.rows} rowKey={(r) => r.categoryId} columns={[
            { key: 'n', header: 'Category', sort: (r) => r.name, render: (r) => <span>{r.name}{!r.inBudget && <> <Badge kind="outline">Not in budget</Badge></>}</span> },
            { key: 'b', header: 'Allocated', num: true, sort: (r) => r.budgetCents, render: (r) => <Money cents={r.budgetCents} /> },
            ...(q.data.elapsedFraction !== null ? [{ key: 'e', header: 'Allocated to date', num: true, render: (r: typeof q.data.rows[number]) => (r.expectedToDateCents !== null ? <Money cents={r.expectedToDateCents} /> : '—') }] : []),
            { key: 'a', header: 'Actual', num: true, sort: (r) => r.actualCents, render: (r) => <Money cents={r.actualCents} /> },
            { key: 'd', header: 'Difference', num: true, sort: (r) => r.differenceCents, render: (r) => <span>{r.status === 'above' ? '↑ ' : r.status === 'below' ? '↓ ' : '= '}<Money cents={Math.abs(r.differenceCents)} /></span> },
            { key: 's', header: 'In words', render: (r) => <span className="small">{r.sentence}</span> },
          ]} footer={<tr><td>Total</td><td className="num"><Money cents={q.data.totals.budgetCents} /></td>{q.data.elapsedFraction !== null && <td />}<td className="num"><Money cents={q.data.totals.actualCents} /></td><td className="num"><Money cents={Math.abs(q.data.totals.differenceCents)} /></td><td className="small">{q.data.totals.differenceCents >= 0 ? 'Below the total allocated' : 'Above the total allocated'}</td></tr>} />
          <Explain>
            Actual is spending in the period for each budgeted category (including its sub-categories unless they have their own line), less refunds. Transfers between your accounts are excluded.
            ↑ means above the amount allocated and ↓ below it. {q.data.elapsedFraction !== null && '"Allocated to date" pro-rates the allocation by the share of the period that has passed.'}
          </Explain>
        </div>
      )}
    </Card>
  );
}

export function Budgets() {
  const q = useApi('budgets.list', undefined, []);
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!q.data) return <Loading />;
  const current = q.data.find((b) => b.id === selected) ?? q.data.find((b) => b.isActive) ?? q.data[0];
  return (
    <Page title="Budgets" intro="Plan amounts for each category and compare them with what actually happened. Differences are described, not judged." actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>New budget</button>}>
      {!q.data.length ? (
        <Card><Empty title="No budget yet" action={<button className="btn btn-primary" onClick={() => setEditing('new')}>Create a budget</button>}>Start from your actual spending history, enter every amount yourself, or combine both.</Empty></Card>
      ) : (
        <>
          <Card>
            <div className="row-between">
              <div className="row">
                {q.data.length > 1 && <SelectField label="Budget" value={current.id} onChange={setSelected} options={q.data.map((b) => ({ value: b.id, label: `${b.name}${b.isActive ? ' (active)' : ''}` }))} />}
                <span><strong>{current.name}</strong> · {FREQUENCY_LABEL[current.frequency]} · {current.method} · {current.lines.length} lines</span>
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => setEditing(current)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirm.ask('Delete budget?', <p>Delete “{current.name}”? Your transactions are not affected.</p>, 'Delete', true)) await api('budgets.delete', { id: current.id }); }}>Delete</button>
              </div>
            </div>
          </Card>
          <Report key={current.id} budget={current} />
        </>
      )}
      {editing && <BudgetEditor initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {confirm.node}
    </Page>
  );
}
