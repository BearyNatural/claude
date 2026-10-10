import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Callout, Card, DataTable, DateField, DateText, Dialog, Empty, ErrorText, Loading, Money, MoneyField, Page, SelectField, Stat } from '../components/ui';
import { LineChart, Meter } from '../components/charts';
import { todayLocal } from '../components/pickers';
import { SUPER_KIND_LABEL, SuperEntryKind } from '@domain/superannuation';
import { financialYearOf, fyDisplay, previousFy, nextFy } from '@domain/dates';

export function Super() {
  const { navigate } = useApp();
  const current = financialYearOf(todayLocal());
  const [fy, setFy] = useState(current);
  const q = useApi('super.overview', { fy }, [fy]);
  const [adding, setAdding] = useState(false);
  const [e, setE] = useState({ accountId: '', date: todayLocal() as string | null, kind: 'balance' as SuperEntryKind, amountCents: null as number | null });
  const save = useAction(async () => {
    const negative = ['fees', 'insurance', 'contributions-tax', 'withdrawal'].includes(e.kind);
    await api('super.saveEntry', { id: '', accountId: e.accountId, date: e.date ?? '', kind: e.kind, amountCents: (negative ? -1 : 1) * Math.abs(e.amountCents ?? 0) });
    setAdding(false);
  });
  if (!q.data) return <Loading />;
  const s = q.data.summary;
  return (
    <Page title="Super" intro="Balances and contributions from your super statements, and projections using assumptions you choose. No fund, option or contribution strategy is recommended."
      actions={<><SelectField label="Financial year" value={fy} onChange={setFy} options={[nextFy(current), current, previousFy(current), previousFy(previousFy(current))].map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} /><button className="btn" onClick={() => navigate('calculators')}>Projection calculator</button><button className="btn btn-primary" disabled={!q.data.accounts.length} onClick={() => { setE({ ...e, accountId: q.data!.accounts[0]?.id ?? '' }); setAdding(true); }}>Add from statement</button></>}>
      {!q.data.accounts.length ? <Card><Empty title="No super account" action={<button className="btn btn-primary" onClick={() => navigate('accounts')}>Add a superannuation account</button>}>Add a superannuation account, then enter balances and contributions from your statements.</Empty></Card> : (
        <>
          <Card title={`Contributions — FY ${fyDisplay(fy)}`}>
            <div className="grid grid-4">
              <Stat label="Employer" value={<Money cents={s.employerCents} />} />
              <Stat label="Salary sacrifice" value={<Money cents={s.salarySacrificeCents} />} />
              <Stat label="Personal (claimed as deduction)" value={<Money cents={s.personalConcessionalCents} />} />
              <Stat label="After-tax (non-concessional)" value={<Money cents={s.nonConcessionalCents} />} />
            </div>
            {s.concessionalCapCents !== null && (
              <div className="stack" style={{ marginTop: 14 }}>
                <div className="row-between small"><span>Concessional contributions recorded: <Money cents={s.concessionalTotalCents} /></span><span>General cap: <Money cents={s.concessionalCapCents} whole /> ({s.capStatus})</span></div>
                <Meter value={s.concessionalTotalCents} max={s.concessionalCapCents} label="Concessional contributions against the general cap" />
                <div className="row-between small"><span>Non-concessional recorded: <Money cents={s.nonConcessionalCents} /></span><span>General cap: <Money cents={s.nonConcessionalCapCents} whole /></span></div>
              </div>
            )}
            <ul className="small muted" style={{ marginTop: 10 }}>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <div className="grid grid-4" style={{ marginTop: 10 }}>
              <Stat label="Fees" value={<Money cents={s.feesCents} />} />
              <Stat label="Insurance premiums" value={<Money cents={s.insuranceCents} />} />
              <Stat label="Investment earnings" value={<Money cents={s.earningsCents} signed />} />
              <Stat label="Tax in the fund" value={<Money cents={s.fundTaxCents} />} note="Contributions tax and similar, less tax benefits on fees. Paid by the fund — not part of your personal tax." />
            </div>
          </Card>
          <Card title="Balance history" sub="Balances from statements, with their dates">
            {q.data.history.length > 1 ? <LineChart title="Super balance" series={[{ name: 'Balance', points: q.data.history.map((h) => ({ date: h.date, value: h.balanceCents })) }]} /> : <p className="muted">Enter at least two statement balances to see the history.</p>}
          </Card>
          <Card title="Statement entries">
            <DataTable rows={[...q.data.entries].reverse()} rowKey={(x) => x.id} maxHeight={360} empty={<p className="muted">No entries yet.</p>} columns={[
              { key: 'd', header: 'Date', render: (x) => <DateText date={x.date} /> },
              { key: 'a', header: 'Account', render: (x) => q.data!.accounts.find((a) => a.id === x.accountId)?.name ?? '' },
              { key: 'k', header: 'Type', render: (x) => SUPER_KIND_LABEL[x.kind] },
              { key: 'v', header: 'Amount', num: true, render: (x) => <Money cents={x.amountCents} /> },
              { key: 'x', header: '', render: (x) => <button className="btn btn-ghost btn-sm" onClick={() => api('super.deleteEntry', { id: x.id })}>Delete</button> },
            ]} />
          </Card>
          <Callout kind="neutral">Contribution caps and super rules change and depend on your circumstances (for example carry-forward of unused caps). The caps shown are the general caps for the year, from the ATO, for information only.</Callout>
        </>
      )}
      {adding && (
        <Dialog title="Add from a super statement" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
          <div className="form-grid">
            <SelectField label="Account" value={e.accountId} onChange={(v) => setE({ ...e, accountId: v })} options={q.data.accounts.map((a) => ({ value: a.id, label: a.name }))} />
            <SelectField label="Type" value={e.kind} onChange={(v) => setE({ ...e, kind: v })} options={Object.entries(SUPER_KIND_LABEL).map(([value, label]) => ({ value: value as SuperEntryKind, label }))} />
            <DateField label="Date" value={e.date} onChange={(v) => setE({ ...e, date: v })} />
            <MoneyField label="Amount" cents={e.amountCents} onChange={(c) => setE({ ...e, amountCents: c })} />
          </div>
          <ErrorText error={save.error} />
        </Dialog>
      )}
    </Page>
  );
}
