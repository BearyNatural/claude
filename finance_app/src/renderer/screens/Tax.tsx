import type { ReactElement } from 'react';
import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, Dialog, ErrorText, Explain, Loading, Money, MoneyField, Page, SelectField, Stat, Tabs, TextField } from '../components/ui';
import { todayLocal } from '../components/pickers';
import { financialYearOf, fyDisplay, formatDate, previousFy } from '@domain/dates';

const STATUS_BADGE: Record<string, ReactElement> = {
  published: <Badge kind="ok">Published</Badge>,
  legislated: <Badge kind="info">Legislated — not yet in ATO tables</Badge>,
  provisional: <Badge kind="warn">Provisional</Badge>,
};

function Estimate({ fy }: { fy: string }) {
  const { navigate } = useApp();
  const q = useApi('tax.estimate', { fy }, [fy]);
  if (!q.data) return <Loading what="Estimating" />;
  const e = q.data;
  if (!e.supported) return <Callout kind="warn">{e.warnings[0]}</Callout>;
  return (
    <div className="stack-lg">
      <div className="disclaimer"><strong>{e.disclaimer}</strong></div>
      <Card title={`Estimated tax position — ${fyDisplay(fy)}`} sub="Estimated based on the records currently available">
        <div className="grid grid-4">
          <Stat label={e.balanceCents >= 0 ? 'Estimated remaining tax' : 'Estimated overpayment'} value={<Money cents={Math.abs(e.balanceCents)} />} note="Not an ATO assessment" />
          <Stat label="Estimated taxable income" value={<Money cents={e.taxableIncomeCents} />} />
          <Stat label="Estimated total tax" value={<Money cents={e.totalLiabilityCents} />} note="Income tax + Medicare levy + study loan − offsets" />
          <Stat label="Tax already paid" value={<Money cents={e.paygWithheldCents + e.paygInstalmentsCents} />} note="PAYG withheld and instalments" />
        </div>
        <p style={{ marginTop: 10 }}>{e.summary}</p>
      </Card>
      {e.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
      <div className="grid grid-2">
        <Card title="Income">
          <DataTable rows={e.income} rowKey={(l) => l.key} empty={<p className="muted">No taxable income recorded yet.</p>} columns={[
            { key: 'l', header: 'Income', render: (l) => <span>{l.label}<div className="muted small">{l.explanation}</div></span> },
            { key: 'a', header: 'Amount', num: true, render: (l) => <Money cents={l.amountCents} /> },
          ]} />
        </Card>
        <Card title="Calculation">
          <DataTable rows={e.steps} rowKey={(s) => s.key} columns={[
            { key: 'l', header: 'Step', render: (s) => <span>{s.label} {s.status && s.status !== 'published' && STATUS_BADGE[s.status]}<div className="muted small">{s.explanation}</div></span> },
            { key: 'a', header: 'Amount', num: true, render: (s) => <Money cents={s.amountCents} /> },
          ]} footer={<tr><td>{e.balanceCents >= 0 ? 'Estimated remaining tax' : 'Estimated overpayment'}</td><td className="num"><Money cents={Math.abs(e.balanceCents)} /></td></tr>} />
          <p className="small muted" style={{ marginTop: 8 }}>Estimated marginal rate including Medicare levy: {e.marginalRatePercent}%.</p>
        </Card>
      </div>
      <Card title="Where the figures came from">
        <ul className="small">{e.sourceLines.map((l) => <li key={l.label}><strong>{l.label}:</strong> {l.basis}</li>)}</ul>
        {e.notes.map((n) => <p key={n} className="small muted" style={{ marginTop: 6 }}>{n}</p>)}
        <Explain label="Sources for these tax rules">
          <ul>{e.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> — reviewed {formatDate(s.reviewed)}{s.pageUpdated ? ` (page updated ${formatDate(s.pageUpdated)})` : ''}</li>)}</ul>
        </Explain>
        <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => navigate('reports', { tab: 'accountant' })}>Prepare records for your tax agent</button></div>
      </Card>
    </div>
  );
}

function Records({ fy }: { fy: string }) {
  const q = useApi('taxEntries.list', { fy }, [fy]);
  const [adding, setAdding] = useState(false);
  const [e, setE] = useState({ kind: 'deduction' as 'deduction' | 'payg-instalment' | 'other-income' | 'payg-withheld-other' | 'reportable-super', description: '', amountCents: 0, date: null as string | null });
  const save = useAction(async () => { await api('taxEntries.save', { fy, ...e }); setAdding(false); setE({ ...e, description: '', amountCents: 0 }); });
  const LABEL = { deduction: 'Deduction', 'payg-instalment': 'PAYG instalment paid', 'other-income': 'Other taxable income', 'payg-withheld-other': 'Tax withheld (not on payslips)', 'reportable-super': 'Reportable super contributions' };
  return (
    <Card title="Tax records for this year" sub="Amounts not captured from transactions or payslips — for example work-related deductions, instalments or income statement figures" actions={<button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Add record</button>}>
      <DataTable rows={q.data ?? []} rowKey={(r) => r.id} empty={<p className="muted">No records. Transactions marked “tax deductible” are included automatically.</p>} columns={[
        { key: 'k', header: 'Type', render: (r) => LABEL[r.kind] },
        { key: 'd', header: 'Description', render: (r) => r.description },
        { key: 'a', header: 'Amount', num: true, render: (r) => <Money cents={r.amountCents} /> },
        { key: 'x', header: '', render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => api('taxEntries.delete', { id: r.id })}>Delete</button> },
      ]} />
      {adding && (
        <Dialog title="Add a tax record" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
          <div className="form-grid">
            <SelectField label="Type" value={e.kind} onChange={(v) => setE({ ...e, kind: v })} options={Object.entries(LABEL).map(([value, label]) => ({ value: value as typeof e.kind, label }))} />
            <TextField label="Description" value={e.description} onChange={(v) => setE({ ...e, description: v })} />
            <MoneyField label="Amount" cents={e.amountCents || null} onChange={(c) => setE({ ...e, amountCents: c ?? 0 })} />
            <DateField label="Date (optional)" value={e.date} onChange={(v) => setE({ ...e, date: v })} />
          </div>
          <p className="small muted">You are responsible for tax classifications. Keep the supporting records — you can attach them on the Documents screen.</p>
          <ErrorText error={save.error} />
        </Dialog>
      )}
    </Card>
  );
}

function Bas({ fy }: { fy: string }) {
  const { settings, setSettings, navigate } = useApp();
  const [quarter, setQuarter] = useState(0);
  const q = useApi('tax.bas', { fy, quarter }, [fy, quarter]);
  return (
    <div className="stack-lg">
      {settings && <Card><Checkbox label="I am registered for GST" checked={settings.gstRegistered} onChange={async (v) => setSettings(await api('settings.update', { gstRegistered: v }))} hint="Only tick this if you have actually registered. Sole traders are not assumed to be registered." /></Card>}
      {q.data && (
        <>
          <Card title="BAS preparation summary" sub={q.data.quarter.label} actions={<SelectField label="Quarter" value={String(quarter)} onChange={(v) => setQuarter(Number(v))} options={q.data.quarters.map((x, i) => ({ value: String(i), label: x.label }))} />}>
            <div className="disclaimer"><strong>{q.data.summary.disclaimer}</strong> Geranium does not lodge anything.</div>
            <div className="grid grid-4" style={{ marginTop: 12 }}>
              <Stat label="G1 Total sales" value={<Money cents={q.data.summary.g1TotalSalesCents} />} note={`${q.data.summary.salesCount} sale(s)`} />
              <Stat label="1A GST on sales" value={<Money cents={q.data.summary.gstOnSales1ACents} />} />
              <Stat label="1B GST on purchases" value={<Money cents={q.data.summary.gstOnPurchases1BCents} />} note={`${q.data.summary.purchaseCount} purchase(s)`} />
              <Stat label="Net GST (1A − 1B)" value={<Money cents={q.data.summary.netGstCents} signed />} />
            </div>
            <ul className="small" style={{ marginTop: 10 }}>{q.data.summary.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Card>
          {q.data.unclassified.length > 0 && (
            <Card title="Business transactions without a GST classification" sub="Set GST on each transaction so it can be included">
              <DataTable rows={q.data.unclassified} rowKey={(r) => r.id} maxHeight={300} columns={[
                { key: 'd', header: 'Date', render: (r) => formatDate(r.date) },
                { key: 'n', header: 'Description', render: (r) => r.description },
                { key: 'a', header: 'Amount', num: true, render: (r) => <Money cents={r.amountCents} signed /> },
              ]} />
              <div className="row" style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => navigate('transactions', { search: 'business' })}>Open business transactions</button></div>
            </Card>
          )}
          <Callout kind="neutral">{q.data.turnoverNote}</Callout>
        </>
      )}
    </div>
  );
}

function RulesInfo({ fy }: { fy: string }) {
  const q = useApi('tax.rules', { fy }, [fy]);
  if (!q.data) return <Callout kind="warn">Rules for this year are not available.</Callout>;
  const r = q.data;
  return (
    <div className="stack-lg">
      {r.fallbackFrom && <Callout kind="warn">Rules for {fyDisplay(fy)} are not in this version; {fyDisplay(r.fallbackFrom)} rules are used.</Callout>}
      <Card title={`Tax rules used for ${fyDisplay(fy)}`} sub={`Last reviewed ${formatDate(r.lastReviewed)}. Tax rules change — they are versioned by financial year.`}>
        <DataTable rows={r.components} rowKey={(c) => c.name} columns={[
          { key: 'n', header: 'Rule', render: (c) => <span>{c.name}{c.note && <div className="muted small">{c.note}</div>}</span> },
          { key: 's', header: 'Status', render: (c) => STATUS_BADGE[c.status] },
          { key: 'src', header: 'Source', render: (c) => <span className="small">{c.sources.map((s) => <div key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></div>)}</span> },
        ]} />
      </Card>
      <Card title="Resident income tax rates">
        <DataTable rows={r.brackets} rowKey={(b) => String(b.over)} columns={[
          { key: 'o', header: 'Taxable income over', num: true, render: (b) => `$${b.over.toLocaleString('en-AU')}` },
          { key: 'r', header: 'Rate on each extra dollar', num: true, render: (b) => `${Math.round(b.rate * 1000) / 10}%` },
        ]} />
        <p className="small muted" style={{ marginTop: 6 }}>Income up to $18,200 is tax-free. Rates exclude the 2% Medicare levy.</p>
      </Card>
    </div>
  );
}

export function Tax() {
  const { settings, setSettings, params } = useApp();
  const current = financialYearOf(todayLocal());
  const years = ['2027-28', '2026-27', '2025-26', '2024-25'].filter((y) => y <= current || y === '2027-28');
  // During tax time (July–October) start with the year that has just ended.
  const month = Number(todayLocal().slice(5, 7));
  const [fy, setFy] = useState(month >= 7 && month <= 10 ? previousFy(current) : current);
  const [tab, setTab] = useState<'estimate' | 'records' | 'bas' | 'rules'>((params.tab as 'bas') ?? 'estimate');
  return (
    <Page title="Tax estimate & GST" intro="An estimate of your Australian income tax position from the records in Geranium. It is not tax preparation, an ATO assessment, or tax advice."
      actions={<SelectField label="Financial year" value={fy} onChange={setFy} options={years.map((y) => ({ value: y, label: `FY ${fyDisplay(y)}${y === current ? ' (current)' : ''}` }))} />}>
      {settings && (
        <Card>
          <div className="row">
            <Checkbox label="I have a HELP or other study/training loan" checked={settings.hasStudyLoan} onChange={async (v) => setSettings(await api('settings.update', { hasStudyLoan: v }))} />
            <Checkbox label="I am exempt from the Medicare levy" checked={settings.medicareExempt} onChange={async (v) => setSettings(await api('settings.update', { medicareExempt: v }))} />
          </div>
          <p className="small muted">The estimate assumes an Australian resident individual for the whole year.</p>
        </Card>
      )}
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ value: 'estimate', label: 'Estimate' }, { value: 'records', label: 'Deductions & other records' }, { value: 'bas', label: 'GST & BAS' }, { value: 'rules', label: 'Rules & sources' }]} />
      {tab === 'estimate' && <Estimate fy={fy} />}
      {tab === 'records' && <Records fy={fy} />}
      {tab === 'bas' && <Bas fy={fy} />}
      {tab === 'rules' && <RulesInfo fy={fy} />}
    </Page>
  );
}
