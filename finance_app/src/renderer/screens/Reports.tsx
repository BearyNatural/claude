import { useState } from 'react';
import { api, IS_WEB, useAction, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateText, Explain, Loading, Page, SelectField, Tabs, TextField } from '../components/ui';
import { RangePicker, RangePreset, presetRange, todayLocal } from '../components/pickers';
import { financialYearOf, fyDisplay, fyRange, previousFy } from '@domain/dates';
import { formatMoney } from '@domain/money';
import { formatDate } from '@domain/dates';

const REPORTS: { value: string; label: string; fy?: boolean }[] = [
  { value: 'cash-flow', label: 'Cash flow by month' }, { value: 'cost-of-living', label: 'Household cost of living' }, { value: 'annual-expenditure', label: 'Annual expenditure by category' },
  { value: 'spending-categories', label: 'Spending by category group' }, { value: 'recurring', label: 'Recurring payments and income' }, { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'income-by-source', label: 'Income by source' }, { value: 'savings-rate', label: 'Savings rate' }, { value: 'interest-income', label: 'Interest income' },
  { value: 'business-summary', label: 'Business income and expenses', fy: true }, { value: 'gst-summary', label: 'GST summary', fy: true }, { value: 'tax-estimate', label: 'Tax estimate', fy: true },
  { value: 'investment-income', label: 'Investment income (dividends)', fy: true }, { value: 'mortgage-progress', label: 'Mortgage progress' }, { value: 'debt', label: 'Debt payoff' },
  { value: 'term-deposits', label: 'Term deposits' }, { value: 'net-worth', label: 'Net worth' },
];

function useYears() {
  const current = financialYearOf(todayLocal());
  return { current, years: [current, previousFy(current), previousFy(previousFy(current))] };
}

function ReportView() {
  const { privacy } = useApp();
  const today = todayLocal();
  const { current, years } = useYears();
  const [kind, setKind] = useState('cash-flow');
  const [preset, setPreset] = useState<RangePreset>('rolling-12');
  const [custom, setCustom] = useState({ start: today, end: today });
  const [fy, setFy] = useState(current);
  const def = REPORTS.find((r) => r.value === kind)!;
  const range = def.fy ? fyRange(fy) : presetRange(preset, today, custom);
  const q = useApi('output.report', { kind, range: { start: range.start, end: range.end }, fy: def.fy ? fy : undefined }, [kind, range.start, range.end, fy]);
  const exp = useAction(async (format: 'csv' | 'xlsx') => api('output.exportReport', { kind, range: { start: range.start, end: range.end }, fy: def.fy ? fy : undefined, format }));
  const fmt = (v: string | number | null, f?: string) => {
    if (v === null || v === undefined) return '—';
    if (f === 'currency' && typeof v === 'number') return privacy ? '$•••••' : formatMoney(Math.round(v * 100));
    if (f === 'percent' && typeof v === 'number') return `${(v * 100).toFixed(1)}%`;
    if (f === 'date' && typeof v === 'string') return formatDate(v);
    return String(v);
  };
  return (
    <div className="stack-lg">
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <SelectField label="Report" value={kind} onChange={setKind} options={REPORTS.map((r) => ({ value: r.value, label: r.label }))} />
          {def.fy ? <SelectField label="Financial year" value={fy} onChange={setFy} options={years.map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} /> : <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
          <button className="btn" onClick={() => exp.run('csv')}>Export CSV</button>
          <button className="btn" onClick={() => exp.run('xlsx')}>Export Excel</button>
        </div>
      </Card>
      {!q.data ? <Loading /> : (
        <Card title={q.data.title}>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr>{q.data.columns.map((c) => <th key={c.header} className={c.format && c.format !== 'text' && c.format !== 'date' ? 'num' : undefined}>{c.header}</th>)}</tr></thead>
              <tbody>{q.data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => { const f = q.data!.columns[j]?.format; return <td key={j} className={f && f !== 'text' && f !== 'date' ? 'num' : undefined}>{fmt(v, f)}</td>; })}</tr>)}</tbody>
            </table>
          </div>
          {q.data.notes.length > 0 && <ul className="small muted" style={{ marginTop: 10 }}>{q.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </Card>
      )}
    </div>
  );
}

function Spreadsheets() {
  const { toast, status } = useApp();
  const today = todayLocal();
  const { current, years } = useYears();
  const names = useApi('output.sheetNames', undefined, []);
  const google = useApi('google.status', undefined, []);
  const [preset, setPreset] = useState<RangePreset>('rolling-12');
  const [custom, setCustom] = useState({ start: today, end: today });
  const [fy, setFy] = useState(current);
  const [sheets, setSheets] = useState<string[] | null>(null);
  const [openAfter, setOpenAfter] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<'snapshot' | 'managed'>('snapshot');
  const [managedId, setManagedId] = useState<string | null>(null);
  const range = presetRange(preset, today, custom);
  const chosen = sheets ?? [...(names.data ?? [])];
  const xlsx = useAction(async () => { const p = await api('output.exportXlsx', { range: { start: range.start, end: range.end }, fy, sheets: chosen, openAfter }); if (p) toast(`Saved ${p}`, 'success'); });
  const gexp = useAction(async () => { const r = await api('google.export', { range: { start: range.start, end: range.end }, fy, sheets: chosen, mode, managedId: mode === 'managed' ? managedId : null }); toast('Google Sheets workbook written.', 'success'); await api('google.openExport', { url: r.url }); google.reload(); });
  const connect = useAction(async () => { await api('google.connect'); google.reload(); toast('Google Sheets connected.', 'success'); });
  return (
    <div className="stack-lg">
      <Card title="What to include">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
            <SelectField label="Financial year for tax sheets" value={fy} onChange={setFy} options={years.map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} />
          </div>
          <div className="choice-grid">
            {(names.data ?? []).map((n) => <Checkbox key={n} label={n} checked={chosen.includes(n)} onChange={(v) => setSheets(v ? [...chosen, n] : chosen.filter((x) => x !== n))} />)}
          </div>
          <p className="small muted">Sheets with nothing to show are left out. Totals and differences are real spreadsheet formulas (for example SUMIFS over the Transactions sheet), so the workbook keeps working without Geranium.</p>
        </div>
      </Card>
      <div className="grid grid-2">
        <Card title="Excel workbook (.xlsx)" sub="Works without Microsoft Excel — opens in Excel, LibreOffice, Numbers or Google Sheets">
          <div className="stack">
            {!IS_WEB && <Checkbox label="Open the workbook after saving" checked={openAfter} onChange={setOpenAfter} hint="Uses whichever spreadsheet program your computer opens .xlsx files with." />}
            <div><button className="btn btn-primary" onClick={() => xlsx.run()} disabled={xlsx.pending}>{xlsx.pending ? 'Building…' : 'Save Excel workbook…'}</button></div>
            {xlsx.error && <Callout kind="danger">{xlsx.error}</Callout>}
          </div>
        </Card>
        <Card title="Google Sheets" sub="Only runs when you choose to export. Your Geranium data file is never uploaded.">
          {status?.demo ? <p className="muted">Not available in demo mode.</p> : !google.data ? <Loading /> : !google.data.configured && IS_WEB ? (
            <p className="small muted">Google Sheets export isn’t set up for this website yet. Excel and CSV exports work now.</p>
          ) : !google.data.configured ? (
            <div className="stack">
              <p className="small">Geranium has no Google account of its own. To use Google Sheets, create a free “Desktop app” OAuth client in your Google Cloud project, enable the Google Sheets API, and paste the client details here.</p>
              <TextField label="OAuth client ID" value={clientId} onChange={setClientId} />
              <TextField label="Client secret (Desktop app clients have one)" value={secret} onChange={setSecret} type="password" />
              <div><button className="btn" disabled={!clientId.trim()} onClick={async () => { await api('google.setClient', { clientId, clientSecret: secret || null }); google.reload(); }}>Save</button></div>
            </div>
          ) : !google.data.connected ? (
            <div className="stack">
              <p className="small">{IS_WEB ? 'Connecting opens Google in a pop-up window; in the browser the connection lasts about an hour.' : 'Connecting opens Google in your web browser.'} Geranium asks only for permission to create spreadsheets and edit the spreadsheets it created (<code>drive.file</code>) — it cannot see your other Google files.</p>
              <div className="row"><button className="btn btn-primary" onClick={() => connect.run()} disabled={connect.pending}>{connect.pending ? 'Waiting for Google…' : 'Connect Google Sheets'}</button><button className="btn btn-ghost btn-sm" onClick={async () => { await api('google.setClient', { clientId: '', clientSecret: null }); google.reload(); }}>Change client</button></div>
              {connect.error && <Callout kind="danger">{connect.error}</Callout>}
            </div>
          ) : (
            <div className="stack">
              <SelectField label="Export as" value={mode} onChange={setMode} options={[{ value: 'snapshot', label: 'A new spreadsheet (snapshot)' }, { value: 'managed', label: 'Update a spreadsheet Geranium manages' }]} />
              {mode === 'managed' && <SelectField label="Managed spreadsheet" value={managedId ?? ''} placeholder="Create a new managed spreadsheet" onChange={(v) => setManagedId(v || null)} options={google.data.exports.filter((e) => e.managed).map((e) => ({ value: e.id, label: `${e.name} (updated ${e.updatedAt.slice(0, 10)})` }))} />}
              <p className="small muted">Geranium only ever updates spreadsheets it created and recorded as managed. It never changes other Google Sheets.</p>
              <div className="row"><button className="btn btn-primary" onClick={() => gexp.run()} disabled={gexp.pending}>{gexp.pending ? 'Writing…' : 'Export to Google Sheets'}</button><button className="btn btn-ghost btn-sm" onClick={async () => { await api('google.disconnect'); google.reload(); }}>Disconnect</button></div>
              {gexp.error && <Callout kind="danger">{gexp.error}</Callout>}
              {google.data.exports.length > 0 && (
                <DataTable rows={google.data.exports} rowKey={(e) => e.id} columns={[
                  { key: 'n', header: 'Spreadsheet', render: (e) => <span>{e.name} {e.managed ? <Badge kind="info">Managed</Badge> : <Badge kind="outline">Snapshot</Badge>}</span> },
                  { key: 'd', header: 'Updated', render: (e) => <DateText date={e.updatedAt.slice(0, 10)} /> },
                  { key: 'o', header: '', render: (e) => <span className="row"><button className="btn btn-sm" onClick={() => api('google.openExport', { url: e.url })}>Open</button><button className="btn btn-ghost btn-sm" onClick={() => api('google.forgetExport', { id: e.id })}>Forget</button></span> },
                ]} />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CsvExports() {
  const { toast } = useApp();
  const today = todayLocal();
  const [preset, setPreset] = useState<RangePreset>('last-2-years');
  const [custom, setCustom] = useState({ start: today, end: today });
  const range = presetRange(preset, today, custom);
  const kinds = [['transactions', 'Transactions'], ['accounts', 'Accounts and balances'], ['categories', 'Categories'], ['rules', 'Rules'], ['budgets', 'Budgets'], ['bills', 'Bills'], ['income', 'Income by source'], ['goals', 'Savings goals'], ['forecast', 'Forecast'], ['payslips', 'Payslips']] as const;
  return (
    <Card title="Export your data as CSV" sub="Your data is yours. CSV files open in any spreadsheet program.">
      <div className="stack">
        <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
        <div className="row">{kinds.map(([k, l]) => <button key={k} className="btn" onClick={async () => { const p = await api('output.exportCsv', { kind: k, range: { start: range.start, end: range.end } }); if (p) toast(`Saved ${p}`, 'success'); }}>{l}</button>)}</div>
        <p className="small muted">Text that starts with =, +, − or @ is saved with a leading apostrophe so spreadsheet programs never treat it as a formula.</p>
      </div>
    </Card>
  );
}

function Accountant() {
  const { toast, status } = useApp();
  const { current, years } = useYears();
  const [fy, setFy] = useState(previousFy(current));
  const all = [['income', 'Income summary and payslips'], ['business', 'Business income and expenses'], ['tax-categories', 'Tax-classified transactions and records'], ['gst', 'GST summary'], ['dividends', 'Dividends and franking'], ['interest', 'Interest income'], ['transactions', 'All transactions (CSV)'], ['documents-index', 'Index of supporting documents']] as const;
  const [include, setInclude] = useState<string[]>(all.map(([k]) => k));
  const [docs, setDocs] = useState(false);
  const run = useAction(async () => { const r = await api('output.accountantPackage', { fy, include, includeDocuments: docs }); if (r) toast(`${r.files.length} files saved to ${r.folder}`, 'success'); });
  return (
    <Card title="Package for your accountant or tax agent" sub="Creates a folder of files you choose. Nothing is sent anywhere — you decide how to share it.">
      <div className="stack">
        <SelectField label="Financial year" value={fy} onChange={setFy} options={years.map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} />
        <div className="choice-grid">{all.map(([k, l]) => <Checkbox key={k} label={l} checked={include.includes(k)} onChange={(v) => setInclude(v ? [...include, k] : include.filter((x) => x !== k))} />)}</div>
        <Checkbox label="Include copies of attached documents" checked={docs} onChange={setDocs} hint={status?.demo ? 'Not available in demo mode.' : 'Receipts, statements and other files linked to this year, decrypted into the folder.'} />
        <div><button className="btn btn-primary" onClick={() => run.run()} disabled={run.pending}>Choose folder and create package…</button></div>
        {run.error && <Callout kind="danger">{run.error}</Callout>}
        <Explain>The package also includes an Excel workbook of tax records and a README explaining each file. The tax estimate included is marked as an estimate — it is not an ATO assessment.</Explain>
      </div>
    </Card>
  );
}

export function Reports() {
  const { params } = useApp();
  const [tab, setTab] = useState<'reports' | 'spreadsheets' | 'csv' | 'accountant'>((params.tab as 'accountant') ?? 'reports');
  return (
    <Page title="Reports & export" intro="Reports answer a question each. Everything can be exported — to Excel, Google Sheets, CSV, or a package for your accountant.">
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ value: 'reports', label: 'Reports' }, { value: 'spreadsheets', label: 'Spreadsheets' }, { value: 'csv', label: 'CSV data' }, { value: 'accountant', label: 'Accountant package' }]} />
      {tab === 'reports' && <ReportView />}
      {tab === 'spreadsheets' && <Spreadsheets />}
      {tab === 'csv' && <CsvExports />}
      {tab === 'accountant' && <Accountant />}
    </Page>
  );
}
