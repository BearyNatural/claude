import { useState } from 'react';
import { useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, DataTable, DateText, Dialog, Explain, Loading, Money, Page, Segmented, Stat, StatusBadge, Tabs } from '../components/ui';
import { BarList, ColumnChart } from '../components/charts';
import { RangePicker, RangePreset, presetRange, todayLocal } from '../components/pickers';
import { formatDate } from '@domain/dates';
import { INCOME_TYPE_LABEL } from '@domain/categorise/categories';

function CategoryDetail({ categoryId, range, onClose }: { categoryId: string; range: { start: string; end: string }; onClose: () => void }) {
  const q = useApi('insights.category', { categoryId, range }, [categoryId, range.start, range.end]);
  const { navigate } = useApp();
  if (!q.data) return <Dialog title="Category" onClose={onClose}><Loading /></Dialog>;
  const a = q.data.averages;
  return (
    <Dialog title={q.data.category.name} wide onClose={onClose} footer={<button className="btn" onClick={() => navigate('transactions', { categoryId })}>See transactions</button>}>
      <div className="stack-lg">
        <div className="grid grid-4">
          <Stat label="Average per week" value={<Money cents={a.perWeek} />} />
          <Stat label="Per fortnight" value={<Money cents={a.perFortnight} />} />
          <Stat label="Per month" value={<Money cents={a.perMonth} />} />
          <Stat label="Per year" value={<Money cents={a.perYear} />} />
        </div>
        <Explain><p>{a.basis.description}</p></Explain>
        <ColumnChart title={`${q.data.category.name} by month`} series={['Spent']} data={q.data.months.map((m) => ({ label: m.label.slice(0, 3), values: [m.totalCents] }))} />
      </div>
    </Dialog>
  );
}

function Analysis({ range }: { range: { start: string; end: string } }) {
  const [level, setLevel] = useState<'top' | 'leaf'>('top');
  const [open, setOpen] = useState<string | null>(null);
  const q = useApi('insights.spending', { range, level }, [range.start, range.end, level]);
  if (!q.data) return <Loading />;
  const s = q.data;
  return (
    <div className="stack-lg">
      {s.partial && s.coveredRange && <Callout kind="warn">Imported data covers {formatDate(s.coveredRange.start)} to {formatDate(s.coveredRange.end)}, not the whole period. Averages use the covered dates only.</Callout>}
      <Card title="Average spending" sub={<><StatusBadge status="actual" /> from your transactions, transfers excluded</>}>
        <div className="grid grid-4">
          <Stat label="Per day" value={<Money cents={s.overall.perDay} />} />
          <Stat label="Per week" value={<Money cents={s.overall.perWeek} />} />
          <Stat label="Per fortnight" value={<Money cents={s.overall.perFortnight} />} />
          <Stat label="Per month" value={<Money cents={s.overall.perMonth} />} />
        </div>
        <div style={{ marginTop: 8 }}><Stat label="Total in period" value={<Money cents={s.overall.totalCents} />} note={<>Per quarter <Money cents={s.overall.perQuarter} /> · per year <Money cents={s.overall.perYear} /></>} /></div>
        <Explain><p>{s.overall.basis.description}</p></Explain>
      </Card>
      <Card title="By category" actions={<Segmented label="Detail" value={level} onChange={setLevel} options={[{ value: 'top', label: 'Groups' }, { value: 'leaf', label: 'Categories' }]} />}>
        <BarList title="Spending by category" rows={s.rows.map((r) => ({ key: r.categoryId ?? 'none', label: r.name, value: r.totalCents }))} onSelect={(k) => k !== 'none' && setOpen(k)} />
        <div style={{ marginTop: 14 }}>
          <DataTable rows={s.rows} rowKey={(r) => r.categoryId ?? 'none'} onRowClick={(r) => r.categoryId && setOpen(r.categoryId)} columns={[
            { key: 'n', header: 'Category', sort: (r) => r.name, render: (r) => <span>{r.name} {r.nature && <span className="muted small">· {r.nature}</span>}</span> },
            { key: 't', header: 'Total', num: true, sort: (r) => r.totalCents, render: (r) => <Money cents={r.totalCents} /> },
            { key: 'w', header: 'Per week', num: true, render: (r) => <Money cents={r.perWeekCents} /> },
            { key: 'f', header: 'Per fortnight', num: true, render: (r) => <Money cents={r.perFortnightCents} /> },
            { key: 'm', header: 'Per month', num: true, render: (r) => <Money cents={r.perMonthCents} /> },
            { key: 'c', header: 'Transactions', num: true, render: (r) => r.transactionCount },
            { key: 'o', header: 'Incl. one-offs', num: true, render: (r) => (r.oneOffCents ? <Money cents={r.oneOffCents} /> : '—') },
          ]} />
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Select a category for its monthly pattern and the exact basis of its averages.</p>
      </Card>
      <Card title="Income by source" sub="As deposited — salary deposits are net pay">
        <DataTable rows={s.income} rowKey={(r) => r.incomeType} empty={<p className="muted">No income recorded in this period.</p>} columns={[
          { key: 't', header: 'Source', render: (r) => (r.incomeType === 'unclassified' ? 'Not classified' : INCOME_TYPE_LABEL[r.incomeType]) },
          { key: 'a', header: 'Received', num: true, render: (r) => <Money cents={r.totalCents} /> },
          { key: 'n', header: 'Payments', num: true, render: (r) => r.count },
        ]} />
      </Card>
      {open && <CategoryDetail categoryId={open} range={range} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CostOfLiving({ range }: { range: { start: string; end: string } }) {
  const q = useApi('insights.costOfLiving', { range }, [range.start, range.end]);
  const [per, setPer] = useState<'week' | 'fortnight' | 'month'>('month');
  if (!q.data) return <Loading />;
  const c = q.data;
  const perVal = (i: { perWeekCents: number; perFortnightCents: number; perMonthCents: number }) => (per === 'week' ? i.perWeekCents : per === 'fortnight' ? i.perFortnightCents : i.perMonthCents);
  const groups = ['fixed', 'variable', 'discretionary', null] as const;
  return (
    <div className="stack-lg">
      <Callout kind="neutral"><strong>Actual cash transactions</strong> are what was paid, when it was paid. <strong>Planning amounts</strong> spread each cost evenly — a $960 yearly registration becomes $80 a month, about $36.92 a fortnight or $18.46 a week. The real transaction is unchanged.</Callout>
      <Card title="What the household costs to run" sub={`Based on ${c.months} months of spending · one-off items left out`} actions={<Segmented label="Show per" value={per} onChange={setPer} options={[{ value: 'week', label: 'Week' }, { value: 'fortnight', label: 'Fortnight' }, { value: 'month', label: 'Month' }]} />}>
        <div className="grid grid-4">
          <Stat hero label={`Planning cost per ${per}`} value={<Money cents={per === 'week' ? c.total.perWeekCents : per === 'fortnight' ? c.total.perFortnightCents : c.total.perMonthCents} />} />
          <Stat label="Per year" value={<Money cents={c.total.annualCents} />} />
          <Stat label="One-offs left out" value={<Money cents={c.excludedOneOffCents} />} note="Mark or unmark one-offs on a transaction" />
        </div>
        <Explain><p>{c.basis}</p></Explain>
      </Card>
      {groups.map((g) => {
        const items = c.items.filter((i) => i.nature === g);
        if (!items.length) return null;
        return (
          <Card key={String(g)} title={g === 'fixed' ? 'Fixed costs' : g === 'variable' ? 'Everyday variable costs' : g === 'discretionary' ? 'Discretionary spending' : 'Other'}>
            <DataTable rows={items} rowKey={(i) => i.categoryId ?? i.name} columns={[
              { key: 'n', header: 'Category', render: (i) => <span>{i.name} {i.regularity === 'irregular' && <Badge kind="outline">Irregular</Badge>}</span> },
              { key: 'a', header: 'Actual paid in period', num: true, render: (i) => <Money cents={i.actualCents} /> },
              { key: 'p', header: `Planning cost per ${per}`, num: true, sort: perVal, render: (i) => <Money cents={perVal(i)} /> },
              { key: 'y', header: 'Per year', num: true, render: (i) => <Money cents={i.annualCents} /> },
            ]} />
          </Card>
        );
      })}
    </div>
  );
}

function Compare() {
  const [kind, setKind] = useState<'month-vs-previous' | 'month-vs-last-year' | 'quarter-vs-previous' | 'fy-vs-previous' | 'rolling-12-vs-previous'>('month-vs-previous');
  const q = useApi('insights.comparison', { kind }, [kind]);
  return (
    <div className="stack-lg">
      <Card>
        <Segmented label="Compare" value={kind} onChange={setKind} options={[
          { value: 'month-vs-previous', label: 'This month vs last' }, { value: 'month-vs-last-year', label: 'This month vs a year ago' },
          { value: 'quarter-vs-previous', label: 'Quarter vs previous' }, { value: 'fy-vs-previous', label: 'Financial year vs previous' }, { value: 'rolling-12-vs-previous', label: 'Rolling 12 months' },
        ]} />
      </Card>
      {!q.data ? <Loading /> : (
        <>
          {q.data.inProgress && <Callout kind="warn">{q.data.inProgress} The comparison is not like-for-like yet.</Callout>}
          <Card title={`${q.data.a.label} compared with ${q.data.b.label}`} sub={<>Total <Money cents={q.data.totals.aCents} /> vs <Money cents={q.data.totals.bCents} /></>}>
            <DataTable rows={q.data.rows} rowKey={(r) => r.categoryId ?? r.name} columns={[
              { key: 'n', header: 'Category', render: (r) => r.name },
              { key: 'a', header: q.data.a.label, num: true, render: (r) => <Money cents={r.aCents} /> },
              { key: 'b', header: q.data.b.label, num: true, render: (r) => <Money cents={r.bCents} /> },
              { key: 'd', header: 'Difference', num: true, render: (r) => <Money cents={r.differenceCents} signed /> },
              { key: 's', header: 'In words', render: (r) => <span className="small">{r.sentence}</span> },
            ]} />
          </Card>
          <div className="grid grid-2">
            {(['a', 'b'] as const).map((k) => (
              <Card key={k} title={`Largest and one-off items · ${q.data![k].label}`} sub="These often explain unusual differences">
                <ul className="list-plain small">
                  {[...q.data!.oneOffs[k].map((t) => ({ ...t, oneOff: true })), ...q.data!.largest[k].filter((t) => !t.isOneOff).map((t) => ({ ...t, oneOff: false }))].slice(0, 7).map((t) => (
                    <li key={t.id} className="row-between"><span><DateText date={t.date} /> {t.description} {t.oneOff && <Badge>One-off</Badge>}</span><Money cents={t.amountCents} signed /></li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Spending() {
  const today = todayLocal();
  const [tab, setTab] = useState<'analysis' | 'cost' | 'compare'>('analysis');
  const [preset, setPreset] = useState<RangePreset>('rolling-12');
  const [custom, setCustom] = useState({ start: today, end: today });
  const range = presetRange(preset, today, custom);
  return (
    <Page title="Spending & cost of living" intro="Where the money actually went — daily, weekly, fortnightly, monthly and yearly — and what the household really costs to run.">
      <div className="row-between">
        <Tabs label="View" value={tab} onChange={setTab} tabs={[{ value: 'analysis', label: 'Where it went' }, { value: 'cost', label: 'True cost of living' }, { value: 'compare', label: 'Compare periods' }]} />
        {tab !== 'compare' && <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
      </div>
      {tab === 'analysis' && <Analysis range={range} />}
      {tab === 'cost' && <CostOfLiving range={range} />}
      {tab === 'compare' && <Compare />}
    </Page>
  );
}
