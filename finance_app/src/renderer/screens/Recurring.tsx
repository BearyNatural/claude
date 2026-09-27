import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { Badge, Callout, Card, Checkbox, DataTable, DateText, Dialog, ErrorText, Explain, Loading, Money, MoneyField, Page, SelectField, Stat, Tabs, TextField } from '../components/ui';
import { CategorySelect } from '../components/pickers';
import { FREQUENCY_LABEL, Frequency } from '@domain/periods';
import type { ApiOutput } from '../../main/api';

type Rec = ApiOutput<'recurring.list'>['confirmed'][number];

function ConfirmDialog({ item, onClose }: { item: Rec; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [frequency, setFreq] = useState<Frequency>(item.frequency);
  const [amount, setAmount] = useState<number | null>(item.amountCents);
  const [categoryId, setCat] = useState<string | null>(item.categoryId);
  const [sub, setSub] = useState(item.isSubscription);
  const save = useAction(async () => {
    await api('recurring.confirm', { key: item.key, name, direction: item.direction, frequency, amountCents: amount ?? 0, amountVaries: item.amountVaries, nextExpected: item.nextExpected, lastSeen: item.lastSeen, categoryId, accountId: item.accountId, isSubscription: sub });
    onClose();
  });
  return (
    <Dialog title="Confirm recurring item" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Confirm</button></>}>
      <p className="muted small">{item.explanation}</p>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} />
        <SelectField label="How often" value={frequency} onChange={setFreq} options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value: value as Frequency, label }))} />
        <MoneyField label={item.amountVaries ? 'Usual amount (it varies)' : 'Amount'} cents={amount} onChange={setAmount} />
        <CategorySelect value={categoryId} onChange={setCat} />
      </div>
      {item.direction === 'out' && <Checkbox label="This is a subscription or membership" checked={sub} onChange={setSub} />}
      <ErrorText error={save.error} />
    </Dialog>
  );
}

export function Recurring() {
  const q = useApi('recurring.list', undefined, []);
  const subs = useApi('recurring.subscriptions', undefined, []);
  const [tab, setTab] = useState<'recurring' | 'subscriptions'>('recurring');
  const [confirming, setConfirming] = useState<Rec | null>(null);
  if (!q.data) return <Loading />;
  const cols = (confirmed: boolean) => [
    { key: 'n', header: 'Name', sort: (r: Rec) => r.name, render: (r: Rec) => <span>{r.name}{r.isSubscription && <> <Badge kind="info">Subscription</Badge></>}<div className="muted small">{r.categoryName ?? 'No category'}</div></span> },
    { key: 'd', header: 'Direction', render: (r: Rec) => (r.direction === 'in' ? 'Money in' : 'Money out') },
    { key: 'f', header: 'How often', render: (r: Rec) => FREQUENCY_LABEL[r.frequency] },
    { key: 'a', header: 'Amount', num: true, sort: (r: Rec) => r.amountCents, render: (r: Rec) => <span><Money cents={r.amountCents} />{r.amountVaries && <div className="muted small">varies</div>}</span> },
    { key: 'y', header: 'Per year', num: true, sort: (r: Rec) => r.annualCents, render: (r: Rec) => <Money cents={r.annualCents} whole /> },
    { key: 'l', header: 'Last', render: (r: Rec) => <span><DateText date={r.lastSeen} />{r.missedSince && <div className="muted small">Not seen on <DateText date={r.missedSince} /></div>}</span> },
    { key: 'x', header: 'Next expected', render: (r: Rec) => <DateText date={r.nextExpected} /> },
    { key: 'c', header: '', render: (r: Rec) => confirmed
      ? <button className="btn btn-ghost btn-sm" onClick={() => api('recurring.remove', { id: r.id! })}>Stop tracking</button>
      : <span className="row"><button className="btn btn-sm btn-primary" onClick={() => setConfirming(r)}>Confirm</button><button className="btn btn-sm" onClick={() => api('recurring.dismiss', { key: r.key, name: r.name })}>Not recurring</button></span> },
  ];
  return (
    <Page title="Recurring & subscriptions" intro="Regular payments and income detected from your history. Confirm the ones that are real — confirmed items feed the cash-flow calendar and forecasts.">
      <Tabs label="View" value={tab} onChange={setTab} tabs={[{ value: 'recurring', label: 'Recurring', count: q.data.suggested.length }, { value: 'subscriptions', label: 'Subscriptions' }]} />
      {tab === 'recurring' && (
        <>
          <Card title="Confirmed" sub={`${q.data.confirmed.length} item(s)`}>
            <DataTable rows={q.data.confirmed} rowKey={(r) => r.key} columns={cols(true)} empty={<p className="muted">Nothing confirmed yet.</p>} />
          </Card>
          <Card title="Detected — please confirm" sub="Suggestions only. Nothing is treated as recurring until you confirm it.">
            <DataTable rows={q.data.suggested} rowKey={(r) => r.key} columns={cols(false)} empty={<p className="muted">No new patterns detected.</p>} />
          </Card>
          <Explain label="How are recurring payments detected?">
            Transactions are grouped by merchant. A group is suggested when there are at least three payments (two for yearly or six-monthly) spaced at a steady interval —
            weekly, fortnightly, every four weeks, monthly, quarterly, six-monthly or yearly — with at least 60% of the gaps fitting, and amounts that do not vary by more than about a third.
            Series with no payment for more than two and a half cycles are treated as stopped.
          </Explain>
        </>
      )}
      {tab === 'subscriptions' && subs.data && (
        <>
          <Card>
            <div className="grid grid-3">
              <Stat label="Confirmed subscriptions per year" value={<Money cents={subs.data.confirmedAnnualCents} />} />
              <Stat label="Per month (spread)" value={<Money cents={Math.round(subs.data.confirmedAnnualCents / 12)} />} />
              <Stat label="Items listed" value={subs.data.items.length} />
            </div>
          </Card>
          <Callout kind="neutral">{subs.data.note}</Callout>
          <Card>
            <DataTable rows={subs.data.items} rowKey={(r) => r.key} columns={cols(false).filter((c) => c.key !== 'd' && c.key !== 'c').concat([{ key: 's', header: 'Status', render: (r: Rec) => <Badge kind={r.status === 'confirmed' ? 'ok' : 'outline'}>{r.status}</Badge> }])} />
          </Card>
        </>
      )}
      {confirming && <ConfirmDialog item={confirming} onClose={() => setConfirming(null)} />}
    </Page>
  );
}
