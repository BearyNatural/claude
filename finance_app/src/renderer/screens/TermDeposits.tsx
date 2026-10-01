import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { Badge, Callout, Card, DataTable, DateField, DateText, Dialog, Empty, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, TextField, useConfirm } from '../components/ui';
import { todayLocal } from '../components/pickers';
import { addMonths } from '@domain/dates';
import type { ApiOutput } from '../../main/api';

type Td = ApiOutput<'termDeposits.list'>['deposits'][number];

function TdForm({ initial, onClose }: { initial?: Td; onClose: () => void }) {
  const [t, setT] = useState({
    id: initial?.id ?? '', institution: initial?.institution ?? '', name: initial?.name ?? null, principalCents: initial?.principalCents ?? 0, startDate: initial?.startDate ?? todayLocal(),
    maturityDate: initial?.maturityDate ?? addMonths(todayLocal(), 6), annualRatePercent: initial?.annualRatePercent ?? 4, interestFrequency: initial?.interestFrequency ?? 'at-maturity',
    interestHandling: initial?.interestHandling ?? 'paid-out', interestDestination: initial?.interestDestination ?? null, notes: initial?.notes ?? null, status: (initial?.status ?? 'active') as 'active' | 'matured' | 'closed', reminderDays: initial?.reminderDays ?? 14,
  });
  const save = useAction(async () => { await api('termDeposits.save', t as never); onClose(); });
  return (
    <Dialog title={initial ? 'Edit term deposit' : 'Add a term deposit'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Institution" value={t.institution} onChange={(v) => setT({ ...t, institution: v })} />
        <TextField label="Name (optional)" value={t.name ?? ''} onChange={(v) => setT({ ...t, name: v || null })} />
        <MoneyField label="Principal" cents={t.principalCents || null} onChange={(c) => setT({ ...t, principalCents: c ?? 0 })} />
        <NumberField label="Interest rate" suffix="% a year" value={t.annualRatePercent} onChange={(v) => setT({ ...t, annualRatePercent: v ?? 0 })} />
        <DateField label="Start date" value={t.startDate} onChange={(v) => v && setT({ ...t, startDate: v })} />
        <DateField label="Maturity date" value={t.maturityDate} onChange={(v) => v && setT({ ...t, maturityDate: v })} />
        <SelectField label="Interest paid" value={t.interestFrequency} onChange={(v) => setT({ ...t, interestFrequency: v })} options={[{ value: 'at-maturity', label: 'At maturity' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annually', label: 'Annually' }]} />
        <SelectField label="Interest is" value={t.interestHandling} onChange={(v) => setT({ ...t, interestHandling: v })} options={[{ value: 'paid-out', label: 'Paid out to another account' }, { value: 'compound', label: 'Added to the deposit (compounding)' }]} />
        <TextField label="Interest goes to (optional)" value={t.interestDestination ?? ''} onChange={(v) => setT({ ...t, interestDestination: v || null })} />
        <NumberField label="Remind me" suffix="days before maturity" value={t.reminderDays} step="1" onChange={(v) => setT({ ...t, reminderDays: Math.round(v ?? 0) })} />
        {initial && <SelectField label="Status" value={t.status} onChange={(v) => setT({ ...t, status: v })} options={[{ value: 'active', label: 'Active' }, { value: 'matured', label: 'Matured' }, { value: 'closed', label: 'Closed' }]} />}
      </div>
      <TextField label="Notes" value={t.notes ?? ''} onChange={(v) => setT({ ...t, notes: v || null })} />
      <ErrorText error={save.error} />
    </Dialog>
  );
}

export function TermDeposits() {
  const q = useApi('termDeposits.list', undefined, []);
  const [edit, setEdit] = useState<Td | 'new' | null>(null);
  const confirm = useConfirm();
  if (!q.data) return <Loading />;
  const active = q.data.deposits.filter((d) => d.status === 'active');
  return (
    <Page title="Term deposits" intro="Expected interest and maturity dates for your term deposits, based on the rates you enter. No deposit is suggested." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}>Add term deposit</button>}>
      {!q.data.deposits.length ? <Card><Empty title="No term deposits" action={<button className="btn btn-primary" onClick={() => setEdit('new')}>Add one</button>} /></Card> : (
        <>
          <Card>
            <div className="grid grid-3">
              <Stat label="Principal in active deposits" value={<Money cents={q.data.totalPrincipalCents} />} />
              <Stat label="Expected interest (active)" value={<Money cents={active.reduce((a, d) => a + d.schedule.totalInterestCents, 0)} />} />
              <Stat label="Next maturity" value={active[0] ? <DateText date={active[0].maturityDate} /> : '—'} note={active[0] ? `${active[0].institution} · in ${active[0].daysToMaturity} days` : undefined} />
            </div>
          </Card>
          <Card title="Maturity timeline" sub="Cash that becomes available as each deposit matures">
            <div className="timeline">
              {q.data.ladder.map((r) => (
                <div key={r.td.id} className="timeline-item">
                  <div className="row-between"><strong><DateText date={r.maturityDate} /> · {r.td.institution}{r.td.name ? ` ${r.td.name}` : ''}</strong>{r.daysUntil < 0 ? <Badge>Matured</Badge> : <Badge kind="outline">in {r.daysUntil} days</Badge>}</div>
                  <div className="small">Principal <Money cents={r.principalCents} /> · expected interest <Money cents={r.interestCents} /> · at maturity <Money cents={r.maturityValueCents} /></div>
                  <div className="small muted">Available by this date from all deposits: <Money cents={r.cumulativeAvailableCents} /></div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="All deposits">
            <DataTable rows={q.data.deposits} rowKey={(d) => d.id} onRowClick={(d) => setEdit(d)} columns={[
              { key: 'i', header: 'Deposit', render: (d) => <span>{d.institution}{d.name ? ` · ${d.name}` : ''} {d.status !== 'active' && <Badge>{d.status}</Badge>}</span> },
              { key: 'p', header: 'Principal', num: true, render: (d) => <Money cents={d.principalCents} /> },
              { key: 'r', header: 'Rate', num: true, render: (d) => `${d.annualRatePercent.toFixed(2)}%` },
              { key: 's', header: 'Term', render: (d) => <span className="small"><DateText date={d.startDate} /> → <DateText date={d.maturityDate} /> ({d.schedule.termDays} days)</span> },
              { key: 'n', header: 'Interest', render: (d) => <span className="small">{d.interestFrequency === 'at-maturity' ? 'At maturity' : d.interestFrequency.charAt(0).toUpperCase() + d.interestFrequency.slice(1)}{d.interestFrequency !== 'at-maturity' ? (d.interestHandling === 'compound' ? ', compounding' : ', paid out') : ''}</span> },
              { key: 'e', header: 'Expected interest', num: true, render: (d) => <Money cents={d.schedule.totalInterestCents} /> },
              { key: 'm', header: 'At maturity', num: true, render: (d) => <Money cents={d.schedule.maturityValueCents} /> },
              { key: 'x', header: '', render: (d) => <button className="btn btn-ghost btn-sm" onClick={async (e) => { e.stopPropagation(); if (await confirm.ask('Delete term deposit?', <p>Delete the record for {d.institution}?</p>, 'Delete', true)) await api('termDeposits.delete', { id: d.id }); }}>Delete</button> },
            ]} />
            <Explain><p>{active[0]?.schedule.explanation ?? 'Interest = balance × rate × days ÷ 365 for each interest period.'}</p></Explain>
          </Card>
          <Callout kind="neutral">Check your deposit confirmation for the institution’s exact figures and rollover instructions. Geranium reminds you before maturity if reminders are on.</Callout>
        </>
      )}
      {edit && <TdForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {confirm.node}
    </Page>
  );
}
