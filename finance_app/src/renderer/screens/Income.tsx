import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, ErrorText, Icon, Loading, Money, MoneyField, Page, Stat, TextField, useConfirm } from '../components/ui';
import { FySelect, todayLocal } from '../components/pickers';
import { INCOME_TYPE_LABEL } from '@domain/categorise/categories';
import { financialYearOf, fyRange, fyDisplay, previousFy } from '@domain/dates';
import { formatMoney } from '@domain/money';
import type { ApiOutput } from '../../main/api';

type Slip = ApiOutput<'payslips.list'>[number];
type SlipRead = NonNullable<ApiOutput<'payslips.readFile'>>;

function PayslipForm({ initial, read, onClose }: { initial?: Slip; read?: SlipRead; onClose: () => void }) {
  const { toast } = useApp();
  const [p, setP] = useState({
    id: initial?.id ?? '', employer: initial?.employer ?? read?.employer ?? '', payDate: initial?.payDate ?? read?.payDate ?? todayLocal(),
    periodStart: initial?.periodStart ?? read?.periodStart ?? null, periodEnd: initial?.periodEnd ?? read?.periodEnd ?? null,
    grossCents: initial?.grossCents ?? read?.grossCents ?? 0, allowancesCents: initial?.allowancesCents ?? read?.allowancesCents ?? 0, salarySacrificeCents: initial?.salarySacrificeCents ?? read?.salarySacrificeCents ?? 0,
    taxableCents: initial?.taxableCents ?? null, paygCents: initial?.paygCents ?? read?.paygCents ?? 0, employerSuperCents: initial?.employerSuperCents ?? read?.employerSuperCents ?? 0,
    deductionsCents: initial?.deductionsCents ?? read?.deductionsCents ?? 0, netCents: initial?.netCents ?? read?.netCents ?? 0, linkedTransactionId: initial?.linkedTransactionId ?? null,
  });
  const [keepFile, setKeepFile] = useState(true);
  const expectedNet = p.grossCents - p.salarySacrificeCents - p.paygCents - p.deductionsCents;
  const save = useAction(async () => {
    const r = await api('payslips.save', { ...p, ...(read ? { sourceToken: read.token, keepFile } : {}) });
    toast(r.linkedTransactionId ? 'Payslip saved and linked to the matching pay deposit.' : 'Payslip saved. No matching deposit was found yet.', 'success');
    onClose();
  });
  return (
    <Dialog title={initial ? 'Edit payslip' : read ? 'Check the imported payslip' : 'Add a payslip'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="stack">
        {read && (
          <>
            <p className="small muted">Read from {read.fileName}{read.found.length ? ` — found ${read.found.join(', ')}` : ''}. Check every figure against the payslip before saving; payslips are laid out differently by every employer.</p>
            {read.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
          </>
        )}
        <div className="form-grid">
          <TextField label="Employer" value={p.employer} onChange={(v) => setP({ ...p, employer: v })} />
          <DateField label="Pay date" value={p.payDate} onChange={(v) => v && setP({ ...p, payDate: v })} />
          <DateField label="Period start" value={p.periodStart} onChange={(v) => setP({ ...p, periodStart: v })} />
          <DateField label="Period end" value={p.periodEnd} onChange={(v) => setP({ ...p, periodEnd: v })} />
          <MoneyField label="Gross pay (including allowances)" cents={p.grossCents || null} onChange={(c) => setP({ ...p, grossCents: c ?? 0 })} />
          <MoneyField label="of which allowances" cents={p.allowancesCents} onChange={(c) => setP({ ...p, allowancesCents: c ?? 0 })} />
          <MoneyField label="Salary sacrifice (before tax)" cents={p.salarySacrificeCents} onChange={(c) => setP({ ...p, salarySacrificeCents: c ?? 0 })} />
          <MoneyField label="Tax withheld (PAYG)" cents={p.paygCents} onChange={(c) => setP({ ...p, paygCents: c ?? 0 })} />
          <MoneyField label="Employer super" cents={p.employerSuperCents} onChange={(c) => setP({ ...p, employerSuperCents: c ?? 0 })} />
          <MoneyField label="After-tax deductions" cents={p.deductionsCents} onChange={(c) => setP({ ...p, deductionsCents: c ?? 0 })} />
          <MoneyField label="Net pay (deposited)" cents={p.netCents || null} onChange={(c) => setP({ ...p, netCents: c ?? 0 })} hint={expectedNet > 0 ? `Gross − salary sacrifice − tax − deductions = ${formatMoney(expectedNet)}` : undefined} />
        </div>
        {p.netCents > 0 && Math.abs(expectedNet - p.netCents) > 1 && <Callout kind="warn">Net pay does not equal gross less salary sacrifice, tax withheld and deductions (difference {formatMoney(Math.abs(expectedNet - p.netCents))}). Check the payslip.</Callout>}
        {read && <Checkbox label="Keep a copy of the payslip (encrypted, linked to this payslip)" checked={keepFile} onChange={setKeepFile} />}
        <ErrorText error={save.error} />
      </div>
    </Dialog>
  );
}

export function Income() {
  const currentFy = financialYearOf(todayLocal());
  const [fy, setFy] = useState(currentFy);
  const slips = useApi('payslips.list', { fy }, [fy]);
  const summary = useApi('insights.spending', { range: fyRange(fy) }, [fy]);
  const [edit, setEdit] = useState<Slip | 'new' | null>(null);
  const [read, setRead] = useState<SlipRead | null>(null);
  const importSlip = useAction(async () => { const r = await api('payslips.readFile'); if (r) setRead(r); });
  const confirm = useConfirm();
  const years = [currentFy, previousFy(currentFy), previousFy(previousFy(currentFy))];
  const list = slips.data ?? [];
  const tot = (f: (s: Slip) => number) => list.reduce((a, s) => a + f(s), 0);
  return (
    <Page title="Income & payslips" intro="A salary deposit is net pay. Gross pay, tax withheld and super come from payslips, so they are recorded here and linked to the deposits."
      actions={<><FySelect value={fy} onChange={setFy} years={years} /><button className="btn" disabled={importSlip.pending} onClick={() => importSlip.run()}><Icon name="upload" size={16} /> Import payslip (PDF)…</button><button className="btn btn-primary" onClick={() => setEdit('new')}>Add payslip</button></>}>
      <ErrorText error={importSlip.error} />
      <Card title={`Payslips — FY ${fyDisplay(fy)}`}>
        {!slips.data ? <Loading /> : (
          <div className="stack">
            <div className="grid grid-4">
              <Stat label="Gross pay" value={<Money cents={tot((s) => s.grossCents)} />} />
              <Stat label="Tax withheld" value={<Money cents={tot((s) => s.paygCents)} />} />
              <Stat label="Employer super" value={<Money cents={tot((s) => s.employerSuperCents)} />} />
              <Stat label="Net pay" value={<Money cents={tot((s) => s.netCents)} />} />
            </div>
            <DataTable rows={list} rowKey={(s) => s.id} onRowClick={(s) => setEdit(s)} empty={<p className="muted">No payslips entered for this year. The tax estimate needs them (or an income statement summary) for employment income and tax withheld.</p>} columns={[
              { key: 'd', header: 'Paid', render: (s) => <DateText date={s.payDate} /> },
              { key: 'e', header: 'Employer', render: (s) => s.employer },
              { key: 'g', header: 'Gross', num: true, render: (s) => <Money cents={s.grossCents} /> },
              { key: 't', header: 'Tax withheld', num: true, render: (s) => <Money cents={s.paygCents} /> },
              { key: 'n', header: 'Net', num: true, render: (s) => <Money cents={s.netCents} /> },
              { key: 'l', header: 'Deposit', render: (s) => (s.linkedTransactionId ? <Badge kind="ok">Linked</Badge> : <Badge kind="warn">No matching deposit</Badge>) },
              { key: 'i', header: '', render: (s) => (s.issues.length ? <Badge kind="warn" >Check figures</Badge> : null) },
              { key: 'x', header: '', render: (s) => <button className="btn btn-ghost btn-sm" onClick={async (e) => { e.stopPropagation(); if (await confirm.ask('Delete payslip?', <p>Delete the {s.employer} payslip for {s.payDate}?</p>, 'Delete', true)) await api('payslips.delete', { id: s.id }); }}>Delete</button> },
            ]} />
          </div>
        )}
      </Card>
      <Card title={`Money received by source — FY ${fyDisplay(fy)}`} sub="As deposited in your accounts">
        {!summary.data ? <Loading /> : (
          <DataTable rows={summary.data.income} rowKey={(r) => r.incomeType} empty={<p className="muted">No income recorded.</p>} columns={[
            { key: 't', header: 'Source', render: (r) => (r.incomeType === 'unclassified' ? <span>Not classified <span className="muted small">— set the income type on the transaction</span></span> : INCOME_TYPE_LABEL[r.incomeType]) },
            { key: 'a', header: 'Received', num: true, render: (r) => <Money cents={r.totalCents} /> },
            { key: 'n', header: 'Payments', num: true, render: (r) => r.count },
          ]} />
        )}
      </Card>
      <Callout kind="neutral">Tell Geranium what each income is — salary, contracting, sole-trader, interest, dividends and so on — by setting the income type on a transaction, or with a rule such as “PAYROLL → Salary”. Contracting payments are not assumed to be profit.</Callout>
      {edit && <PayslipForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {read && <PayslipForm key={read.token} read={read} onClose={() => setRead(null)} />}
      {confirm.node}
    </Page>
  );
}
