import type { ReactElement } from 'react';
import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateText, Dialog, Empty, ErrorText, Explain, Freshness, Loading, Money, Page, Segmented, Stat, useMoneyText } from '../components/ui';
import { BarList, ColumnChart, Meter } from '../components/charts';
import { todayLocal } from '../components/pickers';
import { ACCOUNT_TYPE_LABEL, VALUE_SOURCE_LABEL, isLiability } from '@domain/accounts';
import type { PeriodKind } from '@domain/periods';

const SECTION_LABEL: Record<string, string> = {
  period: 'This period', accounts: 'Accounts', upcoming: 'Coming up', spending: 'Spending by category', budget: 'Budget', goals: 'Goals', warnings: 'Things to check',
};

function difference(now: number, before: number, noun: string, prevLabel: string, money: (c: number) => string): string {
  const d = now - before;
  if (d === 0) return now === 0 ? 'Nothing recorded for this period yet.' : `No change from ${prevLabel}.`;
  return `${money(Math.abs(d))} ${d > 0 ? 'more' : 'less'} ${noun} than ${prevLabel}.`;
}

export function Dashboard() {
  const { settings, navigate, setSettings } = useApp();
  const periods = (settings?.analysisPeriods ?? ['month']).filter((p) => ['week', 'fortnight', 'month', 'quarter'].includes(p)) as PeriodKind[];
  const [kind, setKind] = useState<PeriodKind>(periods[0] ?? 'month');
  const [customise, setCustomise] = useState(false);
  const d = useApi('insights.dashboard', { kind }, [kind]);
  const goals = useApi('goals.list', undefined, []);
  const budgets = useApi('budgets.list', undefined, []);
  const active = budgets.data?.find((b) => b.isActive);
  const budget = useApi('budgets.report', active ? { budgetId: active.id } : undefined as never, [active?.id], !!active);
  const money = useMoneyText();
  const today = todayLocal();

  if (d.error) return <ErrorText error={d.error} />;
  if (!d.data) return <Loading what="Loading your dashboard" />;
  const data = d.data;
  const sections = (data.sections ?? []).filter((s) => s.visible).map((s) => s.id);
  const noData = data.latestTransactionDate === null;

  const blocks: Record<string, ReactElement> = {
    period: (
      <Card key="period" title={data.period.label} sub={data.periodNote ?? (data.periodInProgress ? 'In progress — figures are to date' : 'Complete period')}
        actions={periods.length > 1 ? <Segmented label="Period" value={kind} onChange={setKind} options={periods.map((p) => ({ value: p, label: { week: 'Week', fortnight: 'Fortnight', month: 'Month', quarter: 'Quarter' }[p as 'week'] ?? p }))} /> : undefined}>
        <div className="grid grid-4">
          <Stat label="Money in" value={<Money cents={data.totals.incomeCents} />} note={difference(data.totals.incomeCents, data.previousTotals.incomeCents, 'in', data.comparisonLabel, money)} />
          <Stat label="Spending" value={<Money cents={data.totals.expenseCents} />} note={difference(data.totals.expenseCents, data.previousTotals.expenseCents, 'spent', data.comparisonLabel, money)} />
          <Stat label="Net cash flow" value={<Money cents={data.totals.netCashFlowCents} signed />} note="Money in minus spending" />
          <Stat label="Moved to savings & investments" value={<Money cents={data.totals.savingsCents} />} note={data.savingsRate !== null ? `Savings rate ${(data.savingsRate * 100).toFixed(0)}% of money in` : 'No money in this period, so no savings rate'} />
        </div>
        <div style={{ marginTop: 16 }}>
          <ColumnChart title="Money in and spending by month" series={['Money in', 'Spending']}
            data={data.trend.map((t) => ({ label: t.label.slice(0, 3), values: [t.incomeCents, t.expenseCents], note: t.partial ? 'month to date' : undefined }))}
            summary={`Money in and spending for the last 12 months. Latest month: ${money(data.trend.at(-1)?.incomeCents ?? 0)} in, ${money(data.trend.at(-1)?.expenseCents ?? 0)} spent.`} />
        </div>
        <Explain>
          Money in and spending exclude transfers between your own accounts. Spending is money out in expense categories, less refunds in those categories.
          "Moved to savings & investments" counts transfers into savings, offset, term-deposit, brokerage and super accounts. {data.freshnessNote}
        </Explain>
      </Card>
    ),
    accounts: (
      <Card key="accounts" title="Accounts" sub="Latest known balances — not live" actions={<button className="btn btn-sm" onClick={() => navigate('accounts')}>All accounts</button>}>
        {data.accounts.length === 0 ? <Empty title="No accounts yet" action={<button className="btn btn-primary" onClick={() => navigate('accounts')}>Add an account</button>} /> : (
          <ul className="list-plain">
            {data.accounts.slice(0, 8).map((a) => (
              <li key={a.id} className="row-between">
                <div>
                  <div>{a.name} <span className="muted small">· {ACCOUNT_TYPE_LABEL[a.type]}</span></div>
                  {a.balance ? <Freshness date={a.balance.date} source={VALUE_SOURCE_LABEL[a.balance.source]} today={today} /> : <span className="muted small">No balance yet</span>}
                </div>
                <strong>{a.balance ? <Money cents={isLiability(a.type) ? Math.abs(a.balance.balanceCents) : a.balance.balanceCents} /> : '—'}{isLiability(a.type) && a.balance ? <span className="muted small"> owed</span> : null}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    upcoming: (
      <Card key="upcoming" title="Coming up (30 days)" sub="Bills, expected payments and maturities" actions={<button className="btn btn-sm" onClick={() => navigate('calendar')}>Cash-flow calendar</button>}>
        {data.upcoming.length === 0 ? <p className="muted">Nothing scheduled. Add bills or confirm recurring payments to see them here.</p> : (
          <DataTable rows={data.upcoming.slice(0, 10)} rowKey={(u) => `${u.date}-${u.label}`} columns={[
            { key: 'd', header: 'Date', render: (u) => <DateText date={u.date} /> },
            { key: 'l', header: 'Item', render: (u) => <span>{u.label} {u.daysUntil < 0 && <Badge kind="warn">Overdue</Badge>}</span> },
            { key: 'a', header: 'Amount', num: true, render: (u) => <Money cents={u.amountCents} signed /> },
          ]} />
        )}
      </Card>
    ),
    spending: (
      <Card key="spending" title="Spending by category" sub={data.period.label} actions={<button className="btn btn-sm" onClick={() => navigate('spending')}>Analyse spending</button>}>
        {data.spending.length === 0 ? <p className="muted">No spending recorded in this period yet.</p> : (
          <BarList title="Spending by category" rows={data.spending.map((s) => ({ key: s.categoryId ?? 'none', label: s.name, value: s.totalCents }))} onSelect={(k) => navigate('transactions', k === 'none' ? { search: 'uncategorised' } : { categoryId: k })} />
        )}
      </Card>
    ),
    budget: (
      <Card key="budget" title="Budget" sub={active ? `${active.name}${budget.data ? ` · ${budget.data.period.label}` : ''}` : undefined} actions={<button className="btn btn-sm" onClick={() => navigate('budgets')}>Budgets</button>}>
        {!active ? <p className="muted">No budget yet. Geranium can suggest one from your history.</p> : !budget.data ? <Loading /> : (
          <div className="stack">
            <div className="row-between"><span>Allocated <Money cents={budget.data.totals.budgetCents} /></span><span>Spent so far <Money cents={budget.data.totals.actualCents} /></span></div>
            {budget.data.elapsedFraction !== null && <Meter value={budget.data.totals.actualCents} max={Math.max(1, budget.data.totals.budgetCents)} label="Budget used" />}
            <ul className="list-plain small">{budget.data.rows.filter((r) => r.inBudget).sort((a, b) => a.differenceCents - b.differenceCents).slice(0, 4).map((r) => <li key={r.categoryId}>{r.sentence}</li>)}</ul>
          </div>
        )}
      </Card>
    ),
    goals: (
      <Card key="goals" title="Goals" actions={<button className="btn btn-sm" onClick={() => navigate('goals')}>All goals</button>}>
        {!goals.data?.length ? <p className="muted">No savings goals yet.</p> : (
          <ul className="list-plain">
            {goals.data.slice(0, 4).map((g) => (
              <li key={g.id} className="stack" style={{ gap: 4 }}>
                <div className="row-between"><span>{g.name}</span><span className="small"><Money cents={g.currentCents} whole /> of <Money cents={g.targetCents} whole /></span></div>
                <Meter value={g.currentCents} max={g.targetCents} label={`${g.name} progress`} />
                <span className="muted small">{g.projection.projectedDate ? <>Projected around <DateText date={g.projection.projectedDate} /> (assumes contributions continue)</> : 'Not reached with the current contribution'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    warnings: (
      <Card key="warnings" title="Things to check">
        <div className="stack">
          {data.counts.inbox > 0 && <Callout kind="warn"><button className="btn btn-sm" onClick={() => navigate('inbox')}>Review {data.counts.inbox} imported transaction{data.counts.inbox === 1 ? '' : 's'}</button> They are not included in your figures until approved.</Callout>}
          {data.counts.ruleSuggestions > 0 && <Callout><button className="btn btn-sm" onClick={() => navigate('categories')}>{data.counts.ruleSuggestions} rule suggestion{data.counts.ruleSuggestions === 1 ? '' : 's'}</button> based on your corrections.</Callout>}
          {data.counts.transferSuggestions > 0 && <Callout><button className="btn btn-sm" onClick={() => navigate('categories', { tab: 'transfers' })}>{data.counts.transferSuggestions} possible transfer{data.counts.transferSuggestions === 1 ? '' : 's'}</button> between your accounts to confirm.</Callout>}
          {data.warnings.map((w, i) => <Callout key={i} kind={w.severity === 'warning' ? 'warn' : 'neutral'}>{w.message}</Callout>)}
          {!data.warnings.length && !data.counts.inbox && <p className="muted">Nothing needs attention.</p>}
        </div>
      </Card>
    ),
  };

  return (
    <Page title="Dashboard" intro={data.sentence} actions={<><button className="btn" onClick={() => setCustomise(true)}>Customise</button><button className="btn btn-primary" onClick={() => navigate('import')}>Import statements</button></>}>
      {noData && <Callout title="Getting started">Import a statement or export from your bank to see where your money goes. You can also explore the demo data from the lock screen.</Callout>}
      <div className="grid grid-2">
        {sections.map((s) => (s === 'period' || s === 'warnings' ? <div key={s} style={{ gridColumn: '1 / -1' }}>{blocks[s]}</div> : blocks[s]))}
      </div>
      {customise && settings && (
        <Dialog title="Customise dashboard" onClose={() => setCustomise(false)}>
          <p className="muted small">Choose which sections show and their order.</p>
          <ul className="list-plain">
            {settings.dashboardSections.map((s, i) => (
              <li key={s.id} className="row-between">
                <Checkbox label={SECTION_LABEL[s.id] ?? s.id} checked={s.visible} onChange={async (v) => setSettings(await api('settings.update', { dashboardSections: settings.dashboardSections.map((x) => (x.id === s.id ? { ...x, visible: v } : x)) }))} />
                <span className="row">
                  <button className="btn btn-sm" disabled={i === 0} aria-label={`Move ${SECTION_LABEL[s.id]} up`} onClick={async () => { const l = [...settings.dashboardSections]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setSettings(await api('settings.update', { dashboardSections: l })); }}>↑</button>
                  <button className="btn btn-sm" disabled={i === settings.dashboardSections.length - 1} aria-label={`Move ${SECTION_LABEL[s.id]} down`} onClick={async () => { const l = [...settings.dashboardSections]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; setSettings(await api('settings.update', { dashboardSections: l })); }}>↓</button>
                </span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </Page>
  );
}
