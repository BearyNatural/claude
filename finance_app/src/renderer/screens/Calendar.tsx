import { useState } from 'react';
import { useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, DataTable, DateText, Explain, Loading, Money, Page, Segmented, StatusBadge } from '../components/ui';
import { LineChart } from '../components/charts';
import { formatDate } from '@domain/dates';

const KIND_LABEL: Record<string, string> = {
  employment: 'Pay', business: 'Business income', 'investment-income': 'Investment income', government: 'Government payment', 'super-income': 'Super income', 'other-income': 'Income',
  bill: 'Bill', living: 'Everyday spending', 'loan-repayment': 'Loan repayment', 'investment-contribution': 'Investment', 'other-expense': 'Spending', 'one-off': 'One-off',
  'td-maturity': 'Term deposit', 'savings-interest': 'Interest (assumed)', 'mortgage-repayment': 'Mortgage',
};

export function CalendarScreen() {
  const { navigate } = useApp();
  const [days, setDays] = useState<'30' | '90' | '180' | '365'>('90');
  const q = useApi('forecast.calendar', { days: Number(days) }, [days]);
  const [showAll, setShowAll] = useState(false);
  if (!q.data) return <Loading what="Projecting cash flow" />;
  const c = q.data;
  const events = c.events.filter((e) => showAll || e.kind !== 'living');
  return (
    <Page title="Cash-flow calendar" intro={<>Expected pay, bills, repayments and maturities, with the projected cash balance. <StatusBadge status="forecast" /></>}
      actions={<Segmented label="Look ahead" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '6 months' }, { value: '365', label: '1 year' }]} />}>
      <Callout kind={c.firstBelowThreshold ? 'warn' : 'neutral'}>{c.sentence}{c.firstBelowThreshold ? ` The balance is projected to go below your low-balance marker (${(c.thresholdCents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}) from ${formatDate(c.firstBelowThreshold)}.` : ''}</Callout>
      {c.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
      <Card title="Projected cash balance" sub={c.startingCashAsOf ? `Starts from balances known as at ${formatDate(c.startingCashAsOf)}` : undefined}>
        <LineChart title="Projected cash balance" area series={[{ name: 'Projected cash', points: c.daily.map((p) => ({ date: p.date, value: p.cashCents })) }]} reference={{ value: c.thresholdCents, label: 'Low-balance marker' }}
          summary={c.sentence} />
        <Explain>
          <ul>{c.provenance.map((p) => <li key={p}>{p}</li>)}</ul>
          <p>This is a forecast from scheduled and recurring items and average everyday spending. It changes when you confirm recurring items, add bills or import new statements. Change the assumptions on the Forecast screen.</p>
        </Explain>
      </Card>
      <Card title="Scheduled items" actions={<><button className="btn btn-sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Hide everyday spending' : 'Show everyday spending'}</button><button className="btn btn-sm" onClick={() => navigate('forecast')}>Change assumptions</button></>}>
        <DataTable rows={events} rowKey={(e) => `${e.date}-${e.label}-${e.amountCents}`} maxHeight={600} columns={[
          { key: 'd', header: 'Date', render: (e) => <DateText date={e.date} /> },
          { key: 'l', header: 'Item', render: (e) => <span>{e.label} <Badge kind="outline">{KIND_LABEL[e.kind] ?? e.kind}</Badge></span> },
          { key: 'a', header: 'Amount', num: true, render: (e) => <Money cents={e.amountCents} signed /> },
          { key: 'b', header: 'Projected balance after', num: true, render: (e) => <span>{e.cashAfterCents < c.thresholdCents && <Badge kind="warn">Low</Badge>} <Money cents={e.cashAfterCents} /></span> },
        ]} />
      </Card>
    </Page>
  );
}
