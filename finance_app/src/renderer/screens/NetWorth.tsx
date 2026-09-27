import { useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, DataTable, Explain, Freshness, Loading, Money, Page, Stat } from '../components/ui';
import { LineChart } from '../components/charts';
import { todayLocal } from '../components/pickers';
import { ACCOUNT_TYPE_LABEL, VALUE_SOURCE_LABEL } from '@domain/accounts';
import type { ApiOutput } from '../../main/api';

type Line = ApiOutput<'insights.netWorth'>['assets'][number];

export function NetWorth() {
  const { navigate } = useApp();
  const q = useApi('insights.netWorth', undefined, []);
  const today = todayLocal();
  if (!q.data) return <Loading />;
  const n = q.data;
  const cols = (liab: boolean) => [
    { key: 'n', header: 'Account', render: (l: Line) => <span>{l.name}<div className="muted small">{ACCOUNT_TYPE_LABEL[l.type]}</div></span> },
    { key: 's', header: 'How it is known', render: (l: Line) => (l.balance ? <span><Badge kind={l.balance.source === 'estimated' ? 'warn' : 'outline'}>{VALUE_SOURCE_LABEL[l.balance.source]}</Badge><div><Freshness date={l.balance.date} today={today} /></div></span> : <Badge kind="warn">No value</Badge>) },
    { key: 'v', header: liab ? 'Owed' : 'Value', num: true, render: (l: Line) => (l.balance ? <Money cents={liab ? Math.abs(l.balance.balanceCents) : l.balance.balanceCents} /> : '—') },
  ];
  return (
    <Page title="Net worth" intro="What you own less what you owe, from the latest known value of each account. Every value is dated and labelled." actions={<button className="btn" onClick={() => navigate('accounts')}>Update values</button>}>
      <Card>
        <div className="grid grid-3">
          <Stat hero label="Net worth" value={<Money cents={n.netCents} />} note="Assets − liabilities" />
          <Stat label="Assets" value={<Money cents={n.totalAssetsCents} />} />
          <Stat label="Liabilities" value={<Money cents={n.totalLiabilitiesCents} />} />
        </div>
      </Card>
      {n.notes.map((x) => <Callout key={x} kind="warn">{x}</Callout>)}
      {n.history.length > 1 && (
        <Card title="Net worth over time" sub={`Month-end, using the last known value of each account at that date.${n.historyNote ? ` ${n.historyNote}` : ''}`}>
          <LineChart title="Net worth" series={[{ name: 'Net worth', points: n.history.map((h) => ({ date: h.date, value: h.netCents })) }]} />
          <Explain>Each month uses the most recent value of each account on or before month-end. An account only counts from its first known value, so the chart starts once every account has one. Manual and estimated values (property, vehicles) stay the same until you update them.</Explain>
        </Card>
      )}
      <div className="grid grid-2">
        <Card title="Assets"><DataTable rows={n.assets} rowKey={(l) => l.accountId} columns={cols(false)} empty={<p className="muted">No assets.</p>} /></Card>
        <Card title="Liabilities"><DataTable rows={n.liabilities} rowKey={(l) => l.accountId} columns={cols(true)} empty={<p className="muted">No liabilities.</p>} /></Card>
      </div>
    </Page>
  );
}
