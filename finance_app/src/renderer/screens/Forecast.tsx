import { useEffect, useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, StatusBadge, Tabs, TextField, useConfirm } from '../components/ui';
import { LineChart } from '../components/charts';
import { todayLocal } from '../components/pickers';
import { FREQUENCY_LABEL, Frequency } from '@domain/periods';
import { addMonths, formatDate } from '@domain/dates';
import type { ForecastAssumptions, Scenario, ScenarioChange, Stream } from '@domain/planning/forecast';
import type { ApiOutput } from '../../main/api';

const HORIZONS = [{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '1 year' }, { value: '24', label: '2 years' }, { value: '60', label: '5 years' }, { value: '120', label: '10 years' }, { value: '360', label: '30 years' }];
const KIND_OPTIONS: { value: Stream['kind']; label: string }[] = [
  { value: 'employment', label: 'Employment income' }, { value: 'business', label: 'Business / contracting income' }, { value: 'investment-income', label: 'Investment income' },
  { value: 'super-income', label: 'Super / pension income' }, { value: 'government', label: 'Government payment' }, { value: 'other-income', label: 'Other income' },
  { value: 'bill', label: 'Bill' }, { value: 'living', label: 'Everyday spending' }, { value: 'loan-repayment', label: 'Loan repayment' }, { value: 'investment-contribution', label: 'Investing (moves cash to investments)' }, { value: 'other-expense', label: 'Other spending' },
];
const INCOME = ['employment', 'business', 'investment-income', 'super-income', 'government', 'other-income'];

function describeChange(c: ScenarioChange): string {
  switch (c.type) {
    case 'stop-income': return `Employment income stops from ${formatDate(c.date)}`;
    case 'change-income': return c.newAmountCents !== undefined ? `Employment income becomes ${(c.newAmountCents / 100).toFixed(2)} per payment from ${formatDate(c.date)}` : `Employment income changes by ${c.percentChange}% from ${formatDate(c.date)}`;
    case 'change-expenses': return `Spending changes by ${c.percentChange}% from ${formatDate(c.date)}`;
    case 'one-off': return `${c.label}: ${(c.amountCents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} on ${formatDate(c.date)}`;
    case 'add-stream': return `Add ${c.stream.direction === 'in' ? 'income' : 'spending'} “${c.stream.name}” ${(c.stream.amountCents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} ${FREQUENCY_LABEL[c.stream.frequency].toLowerCase()} from ${formatDate(c.stream.startDate)}`;
    case 'mortgage-rate': return `Mortgage rate ${c.annualRatePercent}% from ${formatDate(c.date)}`;
    case 'mortgage-repayment': return `Mortgage repayment ${(c.repaymentCents / 100).toFixed(2)} from ${formatDate(c.date)}`;
    case 'savings-rate': return `Savings interest ${c.annualRatePercent}% from ${formatDate(c.date)}`;
  }
}

function StreamEditor({ stream, onSave, onClose }: { stream?: Stream; onSave: (s: Stream) => void; onClose: () => void }) {
  const [s, setS] = useState<Stream>(stream ?? { id: `custom-${Date.now()}`, name: '', direction: 'out', kind: 'other-expense', amountCents: 0, frequency: 'monthly', startDate: todayLocal(), endDate: null, source: 'Added by you' });
  return (
    <Dialog title={stream ? 'Edit item' : 'Add income or spending'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!s.name || !s.amountCents} onClick={() => onSave(s)}>Use</button></>}>
      <div className="form-grid">
        <TextField label="Name" value={s.name} onChange={(v) => setS({ ...s, name: v })} />
        <SelectField label="Kind" value={s.kind} onChange={(v) => setS({ ...s, kind: v, direction: INCOME.includes(v) ? 'in' : 'out' })} options={KIND_OPTIONS} />
        <MoneyField label="Amount" cents={s.amountCents || null} onChange={(c) => setS({ ...s, amountCents: c ?? 0 })} />
        <SelectField label="How often" value={s.frequency} onChange={(v) => setS({ ...s, frequency: v })} options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value: value as Frequency, label }))} />
        <DateField label="From" value={s.startDate} onChange={(v) => v && setS({ ...s, startDate: v })} />
        <DateField label="Until (optional)" value={s.endDate ?? null} onChange={(v) => setS({ ...s, endDate: v })} />
        <NumberField label="Yearly growth (optional)" suffix="%" value={s.growthPercent ?? null} onChange={(v) => setS({ ...s, growthPercent: v })} hint="Blank uses wage growth (employment) or inflation (spending)." />
      </div>
    </Dialog>
  );
}

function ChangeEditor({ onAdd, onClose }: { onAdd: (c: ScenarioChange) => void; onClose: () => void }) {
  const [type, setType] = useState<ScenarioChange['type']>('stop-income');
  const [date, setDate] = useState<string | null>(addMonths(todayLocal(), 3));
  const [pct, setPct] = useState<number | null>(-20);
  const [amount, setAmount] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [stream, setStream] = useState<Stream | null>(null);
  const [editingStream, setEditingStream] = useState(false);
  const build = (): ScenarioChange | null => {
    if (!date && type !== 'add-stream') return null;
    switch (type) {
      case 'stop-income': return { type, date: date! };
      case 'change-income': return { type, date: date!, percentChange: pct ?? 0 };
      case 'change-expenses': return { type, date: date!, percentChange: pct ?? 0 };
      case 'one-off': return amount ? { type, date: date!, amountCents: (dir === 'out' ? -1 : 1) * amount, label: label || (dir === 'out' ? 'One-off expense' : 'One-off income') } : null;
      case 'mortgage-rate': return rate !== null ? { type, date: date!, annualRatePercent: rate } : null;
      case 'mortgage-repayment': return amount ? { type, date: date!, repaymentCents: amount } : null;
      case 'savings-rate': return rate !== null ? { type, date: date!, annualRatePercent: rate } : null;
      case 'add-stream': return stream ? { type, stream } : null;
    }
  };
  const c = build();
  return (
    <Dialog title="Add a change" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!c} onClick={() => c && onAdd(c)}>Add change</button></>}>
      <div className="form-grid">
        <SelectField label="Change" value={type} onChange={setType} options={[
          { value: 'stop-income', label: 'Employment income stops' }, { value: 'change-income', label: 'Employment income changes by a %' }, { value: 'change-expenses', label: 'Spending changes by a %' },
          { value: 'one-off', label: 'One-off amount (purchase, deposit, windfall)' }, { value: 'add-stream', label: 'New income or spending (e.g. super pension)' },
          { value: 'mortgage-rate', label: 'Mortgage interest rate' }, { value: 'mortgage-repayment', label: 'Mortgage repayment amount' }, { value: 'savings-rate', label: 'Savings interest rate' },
        ]} />
        {type !== 'add-stream' && <DateField label="From / on" value={date} onChange={setDate} />}
        {(type === 'change-income' || type === 'change-expenses') && <NumberField label="Change" suffix="%" value={pct} onChange={setPct} hint="Use a negative number for a reduction." />}
        {type === 'one-off' && <><SelectField label="Money" value={dir} onChange={setDir} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} /><MoneyField label="Amount" cents={amount} onChange={setAmount} /><TextField label="Label" value={label} onChange={setLabel} /></>}
        {type === 'mortgage-repayment' && <MoneyField label="New repayment" cents={amount} onChange={setAmount} />}
        {(type === 'mortgage-rate' || type === 'savings-rate') && <NumberField label="Rate" suffix="% a year" value={rate} onChange={setRate} />}
      </div>
      {type === 'add-stream' && <div style={{ marginTop: 10 }}>{stream ? <p>{stream.name} <button className="btn btn-sm" onClick={() => setEditingStream(true)}>Edit</button></p> : <button className="btn" onClick={() => setEditingStream(true)}>Describe the income or spending…</button>}</div>}
      {editingStream && <StreamEditor stream={stream ?? undefined} onSave={(s) => { setStream(s); setEditingStream(false); }} onClose={() => setEditingStream(false)} />}
    </Dialog>
  );
}

function ScenarioEditor({ initial, onClose }: { initial: Scenario; onClose: () => void }) {
  const [s, setS] = useState<Scenario>(initial);
  const [adding, setAdding] = useState(false);
  const save = useAction(async () => { await api('scenarios.save', { ...s, id: s.id.startsWith('tpl-') ? '' : s.id } as never); onClose(); });
  return (
    <Dialog title={initial.id && !initial.id.startsWith('tpl-') ? 'Edit scenario' : 'New scenario'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!s.name.trim()} onClick={() => save.run()}>Save scenario</button></>}>
      <div className="stack">
        <div className="form-grid"><TextField label="Name" value={s.name} onChange={(v) => setS({ ...s, name: v })} /><TextField label="Description" value={s.description ?? ''} onChange={(v) => setS({ ...s, description: v })} /></div>
        <h3>Changes from the current path</h3>
        {!s.changes.length ? <p className="muted">No changes — this is the same as the current path.</p> : <ul className="list-plain">{s.changes.map((c, i) => <li key={i} className="row-between"><span>{describeChange(c)}</span><button className="btn btn-ghost btn-sm" onClick={() => setS({ ...s, changes: s.changes.filter((_, j) => j !== i) })}>Remove</button></li>)}</ul>}
        <div><button className="btn" onClick={() => setAdding(true)}>Add a change</button></div>
        <ErrorText error={save.error} />
      </div>
      {adding && <ChangeEditor onAdd={(c) => { setS({ ...s, changes: [...s.changes, c] }); setAdding(false); }} onClose={() => setAdding(false)} />}
    </Dialog>
  );
}

type Built = ApiOutput<'forecast.assumptions'>;

export function Forecast() {
  const { toast, setSettings, settings } = useApp();
  const [tab, setTab] = useState<'forecast' | 'scenarios' | 'snapshots'>('forecast');
  const [months, setMonths] = useState('24');
  const built = useApi('forecast.assumptions', { months: Number(months) }, [months]);
  const [a, setA] = useState<ForecastAssumptions | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ApiOutput<'forecast.run'> | null>(null);
  const [editingStream, setEditingStream] = useState<Stream | 'new' | null>(null);
  const [scenarioEdit, setScenarioEdit] = useState<Scenario | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ApiOutput<'scenarios.run'> | null>(null);
  const [snapName, setSnapName] = useState('');
  const [snapScenario, setSnapScenario] = useState<string>('base');
  const [snapCompare, setSnapCompare] = useState<[string | null, string | null]>([null, null]);
  const scenarios = useApi('scenarios.list', undefined, []);
  const snapshots = useApi('scenarios.snapshots', undefined, []);
  const snapCmp = useApi('scenarios.compareSnapshots', { a: snapCompare[0] ?? '', b: snapCompare[1] ?? '' }, [snapCompare[0], snapCompare[1]], !!(snapCompare[0] && snapCompare[1] && snapCompare[0] !== snapCompare[1]));
  const confirm = useConfirm();

  useEffect(() => { if (built.data) { setA(built.data.assumptions); setExcluded(new Set()); } }, [built.data]);
  const effective = (): ForecastAssumptions | null => (a ? { ...a, streams: a.streams.filter((s) => !excluded.has(s.id)) } : null);
  const run = useAction(async () => { const e = effective(); if (e) setResult(await api('forecast.run', { assumptions: e as never })); });
  useEffect(() => { if (a) void run.run(); }, [a, excluded]); // eslint-disable-line react-hooks/exhaustive-deps
  const compare = useAction(async () => { const e = effective(); if (e) setComparison(await api('scenarios.run', { assumptions: e as never, ids: compareIds })); });

  if (!built.data || !a) return <Loading what="Building assumptions from your data" />;
  const b: Built = built.data;
  const set = <K extends keyof ForecastAssumptions>(k: K, v: ForecastAssumptions[K]) => setA({ ...a, [k]: v });
  return (
    <Page title="Forecast & scenarios" intro={<>Where your money could go under assumptions you can see and change. <StatusBadge status="forecast" /> Scenarios never change your actual records.</>}
      actions={<SelectField label="Forecast length" value={months} onChange={setMonths} options={HORIZONS} />}>
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ value: 'forecast', label: 'Forecast' }, { value: 'scenarios', label: 'Scenarios' }, { value: 'snapshots', label: 'Saved snapshots' }]} />
      {b.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
      {tab === 'forecast' && (
        <>
          {result && (
            <Card title="Projected position" sub={`To ${formatDate(result.endDate)}`}>
              <div className="stack">
                <Callout kind={result.firstBelowZero ? 'warn' : 'neutral'}>{result.summary}</Callout>
                <div className="grid grid-4">
                  <Stat label="Cash at the end" value={<Money cents={result.end.cashCents} />} />
                  <Stat label="Lowest cash" value={<Money cents={result.lowest.cashCents} />} note={<>on <DateText date={result.lowest.date} /></>} />
                  <Stat label="Net position at the end" value={<Money cents={result.end.netPositionCents} />} note="Cash + investments + term deposits − mortgage" />
                  <Stat label="Mortgage at the end" value={<Money cents={result.end.mortgageCents} />} note={result.mortgagePayoffDate ? <>Repaid around <DateText date={result.mortgagePayoffDate} /></> : undefined} />
                </div>
                <LineChart title="Projected cash" area series={[{ name: 'Projected cash', points: result.points.map((p) => ({ date: p.date, value: p.cashCents })) }]} reference={{ value: a.lowBalanceThresholdCents, label: 'Low-balance marker' }} summary={result.summary} />
                <LineChart title="Projected net position" series={[{ name: 'Net position', points: result.points.map((p) => ({ date: p.date, value: p.netPositionCents })) }]} height={180} />
                <Explain label="Every assumption used">
                  <ul>{result.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
                  <p>Totals over the forecast: income <Money cents={result.totals.incomeCents} />, spending <Money cents={result.totals.spendingCents} />, assumed savings interest <Money cents={result.totals.savingsInterestCents} />, mortgage interest <Money cents={result.totals.mortgageInterestCents} />, assumed investment growth <Money cents={result.totals.investmentGrowthCents} />.</p>
                </Explain>
              </div>
            </Card>
          )}
          <Card title="Assumptions" sub="Built from your data. Change anything — nothing here alters your records."
            actions={<><button className="btn btn-sm" onClick={() => built.reload()}>Rebuild from data</button>{settings && <button className="btn btn-sm" onClick={async () => { setSettings(await api('settings.update', { forecast: { inflationPercent: a.inflationPercent, wageGrowthPercent: a.wageGrowthPercent, savingsInterestPercent: a.savingsInterestPercent, investmentReturnPercent: a.investmentReturnPercent, lowBalanceThresholdCents: a.lowBalanceThresholdCents } })); toast('Saved as your default assumptions.', 'success'); }}>Save rates as defaults</button>}</>}>
            <div className="form-grid">
              <MoneyField label="Starting cash" cents={a.startingCashCents} onChange={(c) => set('startingCashCents', c ?? 0)} allowNegative hint={a.startingCashAsOf ? `Latest known balances as at ${formatDate(a.startingCashAsOf)}` : undefined} />
              <NumberField label="Inflation on spending" suffix="% a year" value={a.inflationPercent} onChange={(v) => set('inflationPercent', v ?? 0)} />
              <NumberField label="Wage growth" suffix="% a year" value={a.wageGrowthPercent} onChange={(v) => set('wageGrowthPercent', v ?? 0)} />
              <NumberField label="Interest on cash savings" suffix="% a year" value={a.savingsInterestPercent} onChange={(v) => set('savingsInterestPercent', v ?? 0)} />
              <NumberField label="Investment return" suffix="% a year" value={a.investmentReturnPercent} onChange={(v) => set('investmentReturnPercent', v ?? 0)} hint="An assumption, not a prediction." />
              <MoneyField label="Low-balance marker" cents={a.lowBalanceThresholdCents} onChange={(c) => set('lowBalanceThresholdCents', c ?? 0)} />
            </div>
            <Explain label="Where these numbers came from"><ul>{b.provenance.map((p) => <li key={p}>{p}</li>)}</ul></Explain>
          </Card>
          <Card title="Income and spending in the forecast" actions={<button className="btn btn-sm" onClick={() => setEditingStream('new')}>Add item</button>}>
            <DataTable rows={a.streams} rowKey={(s) => s.id} columns={[
              { key: 'i', header: 'Include', render: (s) => <input type="checkbox" aria-label={`Include ${s.name}`} checked={!excluded.has(s.id)} onChange={() => setExcluded((e) => { const n = new Set(e); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} /> },
              { key: 'n', header: 'Item', render: (s) => <span>{s.name}<div className="muted small">{s.source}</div></span> },
              { key: 'd', header: 'Type', render: (s) => <Badge kind="outline">{s.direction === 'in' ? 'Income' : 'Spending'}</Badge> },
              { key: 'a', header: 'Amount', num: true, render: (s) => <Money cents={s.amountCents} /> },
              { key: 'f', header: 'How often', render: (s) => FREQUENCY_LABEL[s.frequency] },
              { key: 'x', header: '', render: (s) => <button className="btn btn-ghost btn-sm" onClick={() => setEditingStream(s)}>Edit</button> },
            ]} />
            {a.termDeposits.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Term deposits returning to cash: {a.termDeposits.map((t) => `${t.label} on ${formatDate(t.maturityDate)}`).join('; ')}.</p>}
            {a.mortgage && <p className="small muted">Mortgage: <Money cents={a.mortgage.balanceCents} /> at {a.mortgage.annualRatePercent}%, repayments <Money cents={a.mortgage.repaymentCents} /> {a.mortgage.frequency}{a.mortgage.offsetIsCash ? ', with your cash balance treated as the offset' : ''}.</p>}
          </Card>
        </>
      )}
      {tab === 'scenarios' && scenarios.data && (
        <>
          <Card title="Start a scenario" sub="Examples to adapt — none is suggested as better than another">
            <div className="row">{scenarios.data.templates.map((t) => <button key={t.id} className="btn btn-sm" onClick={() => setScenarioEdit(t)} title={t.description ?? undefined}>{t.name}</button>)}</div>
          </Card>
          <Card title="Your scenarios" sub="Choose up to three to compare with the current path">
            {!scenarios.data.scenarios.length ? <p className="muted">No scenarios yet.</p> : (
              <ul className="list-plain">
                {scenarios.data.scenarios.map((s) => (
                  <li key={s.id} className="row-between">
                    <span className="row"><Checkbox label={<strong>{s.name}</strong>} checked={compareIds.includes(s.id)} onChange={(v) => setCompareIds(v ? [...compareIds, s.id].slice(-3) : compareIds.filter((x) => x !== s.id))} />
                      <span className="muted small">{s.changes.map(describeChange).join('; ') || 'No changes'}</span></span>
                    <span className="row">
                      <button className="btn btn-sm" onClick={() => setScenarioEdit(s)}>Edit</button>
                      <button className="btn btn-sm" onClick={() => api('scenarios.duplicate', { id: s.id })}>Duplicate</button>
                      <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm.ask('Delete scenario?', <p>Delete “{s.name}”? Saved snapshots are kept.</p>, 'Delete', true)) await api('scenarios.delete', { id: s.id }); }}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-actions"><button className="btn btn-primary" disabled={!compareIds.length} onClick={() => compare.run()}>Compare</button></div>
            <ErrorText error={compare.error} />
          </Card>
          {comparison && (
            <Card title="Comparison" sub={`${months} months, same assumptions for every scenario`}>
              <LineChart title="Projected cash by scenario" series={comparison.results.map((r) => ({ name: r.scenario.name, points: r.result.points.map((p) => ({ date: p.date, value: p.cashCents })) }))} summary={comparison.comparison.map((c) => c.sentence).join(' ')} />
              <DataTable rows={comparison.comparison} rowKey={(c) => c.scenarioId} columns={[
                { key: 'n', header: 'Scenario', render: (c) => c.name },
                { key: 'e', header: 'Cash at end', num: true, render: (c) => <Money cents={c.endCashCents} /> },
                { key: 'l', header: 'Lowest cash', num: true, render: (c) => <span><Money cents={c.lowestCashCents} /><div className="muted small"><DateText date={c.lowestDate} /></div></span> },
                { key: 'z', header: 'Cash below zero from', render: (c) => (c.cashPositiveUntil ? <DateText date={c.cashPositiveUntil} /> : 'Not in this period') },
                { key: 'm', header: 'Mortgage repaid', render: (c) => (c.mortgagePayoffDate ? <DateText date={c.mortgagePayoffDate} /> : '—') },
              ]} />
              <ul className="small" style={{ marginTop: 10 }}>{comparison.comparison.map((c) => <li key={c.scenarioId}>{c.sentence}</li>)}</ul>
              <Callout kind="neutral">These are mathematical outcomes of the assumptions entered. They do not say which choice is right for you, whether you can afford to stop work, or what to do.</Callout>
            </Card>
          )}
        </>
      )}
      {tab === 'snapshots' && (
        <>
          <Card title="Save a snapshot" sub="Keep today’s assumptions and results, e.g. “Retirement plan — September 2026”, to compare with a later version">
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <SelectField label="Scenario" value={snapScenario} onChange={setSnapScenario} options={[{ value: 'base', label: 'Current path' }, ...(scenarios.data?.scenarios ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
              <TextField label="Snapshot name" value={snapName} onChange={setSnapName} placeholder={`Plan — ${formatDate(todayLocal(), { long: true }).slice(3)}`} />
              <button className="btn btn-primary" onClick={async () => { const e = effective(); if (!e) return; await api('scenarios.saveSnapshot', { assumptions: e as never, scenarioId: snapScenario === 'base' ? null : snapScenario, name: snapName }); setSnapName(''); toast('Snapshot saved.', 'success'); }}>Save snapshot</button>
            </div>
          </Card>
          <Card title="Saved snapshots">
            <DataTable rows={snapshots.data ?? []} rowKey={(s) => s.id} empty={<p className="muted">No snapshots yet.</p>} columns={[
              { key: 'n', header: 'Snapshot', render: (s) => <span>{s.name}<div className="muted small">Saved <DateText date={s.createdAt.slice(0, 10)} /></div></span> },
              { key: 'e', header: 'Cash at end', num: true, render: (s) => <Money cents={s.summary?.endCashCents ?? null} /> },
              { key: 'l', header: 'Lowest cash', num: true, render: (s) => <Money cents={s.summary?.lowest.cashCents ?? null} /> },
              { key: 'c', header: 'Compare', render: (s) => <span className="row"><button className="btn btn-sm" aria-pressed={snapCompare[0] === s.id} onClick={() => setSnapCompare([s.id, snapCompare[1]])}>A</button><button className="btn btn-sm" aria-pressed={snapCompare[1] === s.id} onClick={() => setSnapCompare([snapCompare[0], s.id])}>B</button></span> },
              { key: 'x', header: '', render: (s) => <button className="btn btn-ghost btn-sm" onClick={() => api('scenarios.deleteSnapshot', { id: s.id })}>Delete</button> },
            ]} />
          </Card>
          {snapCmp.data && (
            <Card title={`${snapCmp.data.a.name} vs ${snapCmp.data.b.name}`}>
              <DataTable rows={snapCmp.data.outcome} rowKey={(o) => o.label} columns={[{ key: 'l', header: 'Outcome', render: (o) => o.label }, { key: 'a', header: 'A', num: true, render: (o) => <Money cents={o.a} /> }, { key: 'b', header: 'B', num: true, render: (o) => <Money cents={o.b} /> }]} />
              <h3 style={{ marginTop: 12 }}>What changed in the assumptions</h3>
              {snapCmp.data.assumptionDifferences.length ? <ul className="small">{snapCmp.data.assumptionDifferences.map((d) => <li key={d.label}><strong>{d.label}:</strong> {d.a} → {d.b}</li>)}</ul> : <p className="muted">The assumptions are the same.</p>}
            </Card>
          )}
        </>
      )}
      {editingStream && <StreamEditor stream={editingStream === 'new' ? undefined : editingStream} onClose={() => setEditingStream(null)} onSave={(s) => { setA({ ...a, streams: a.streams.some((x) => x.id === s.id) ? a.streams.map((x) => (x.id === s.id ? s : x)) : [...a.streams, s] }); setEditingStream(null); }} />}
      {scenarioEdit && <ScenarioEditor initial={scenarioEdit} onClose={() => setScenarioEdit(null)} />}
      {confirm.node}
    </Page>
  );
}
