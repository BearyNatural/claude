import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, Tabs, TextField } from '../components/ui';
import { AccountSelect, todayLocal } from '../components/pickers';
import { financialYearOf, fyDisplay, previousFy } from '@domain/dates';
import type { ApiOutput } from '../../main/api';

type Overview = ApiOutput<'investments.overview'>;

function TradeForm({ ov, onClose }: { ov: Overview; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'share' | 'etf' | 'managed-fund' | 'other'>('share');
  const [t, setT] = useState({ date: todayLocal() as string | null, type: 'buy' as 'buy' | 'sell', quantity: null as number | null, price: null as number | null, brokerage: 0 as number | null, costUnknown: false, accountId: null as string | null });
  const save = useAction(async () => {
    const existing = ov.securities.find((s) => s.code === code.trim().toUpperCase());
    const securityId = existing?.id ?? (await api('investments.saveSecurity', { code, name: name || code, kind }));
    await api('investments.saveTrade', { id: '', securityId, accountId: t.accountId, date: t.date ?? '', type: t.type, quantity: t.quantity ?? 0, unitPriceCents: t.price ?? 0, brokerageCents: t.brokerage ?? 0, costUnknown: t.costUnknown });
    onClose();
  });
  return (
    <Dialog title="Record a trade" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Code" value={code} onChange={setCode} placeholder="e.g. VAS" />
        {!ov.securities.some((s) => s.code === code.trim().toUpperCase()) && <><TextField label="Name" value={name} onChange={setName} /><SelectField label="Kind" value={kind} onChange={setKind} options={[{ value: 'share', label: 'Share' }, { value: 'etf', label: 'ETF' }, { value: 'managed-fund', label: 'Managed fund' }, { value: 'other', label: 'Other' }]} /></>}
        <SelectField label="Trade" value={t.type} onChange={(v) => setT({ ...t, type: v })} options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} />
        <DateField label="Trade date (contract date)" value={t.date} onChange={(v) => setT({ ...t, date: v })} />
        <NumberField label="Units" value={t.quantity} onChange={(v) => setT({ ...t, quantity: v })} />
        <MoneyField label="Price per unit" cents={t.price} onChange={(c) => setT({ ...t, price: c })} />
        <MoneyField label="Brokerage" cents={t.brokerage} onChange={(c) => setT({ ...t, brokerage: c })} />
        <AccountSelect label="Broker account (optional)" value={t.accountId} onChange={(v) => setT({ ...t, accountId: v })} allowNone types={['brokerage', 'brokerage-cash']} />
      </div>
      {t.type === 'buy' && <Checkbox label="I don’t know what these units cost (for example inherited)" checked={t.costUnknown} onChange={(v) => setT({ ...t, costUnknown: v })} hint="Geranium will not guess a cost base. Any capital gain estimate for them will show as unavailable." />}
      <ErrorText error={save.error} />
    </Dialog>
  );
}

function DividendForm({ ov, onClose }: { ov: Overview; onClose: () => void }) {
  const [d, setD] = useState({ securityId: ov.securities[0]?.id ?? '', paymentDate: todayLocal() as string | null, cashCents: null as number | null, frankedCents: null as number | null, unfrankedCents: 0 as number | null, frankingCreditsCents: null as number | null, fromStatement: true });
  const save = useAction(async () => { await api('investments.saveDividend', { id: '', securityId: d.securityId, paymentDate: d.paymentDate ?? '', cashCents: d.cashCents ?? 0, frankedCents: d.frankedCents ?? 0, unfrankedCents: d.unfrankedCents ?? 0, frankingCreditsCents: d.fromStatement ? d.frankingCreditsCents ?? 0 : 0, fromStatement: d.fromStatement }); onClose(); });
  return (
    <Dialog title="Record a dividend or distribution" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <SelectField label="Security" value={d.securityId} onChange={(v) => setD({ ...d, securityId: v })} options={ov.securities.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
        <DateField label="Payment date" value={d.paymentDate} onChange={(v) => setD({ ...d, paymentDate: v })} />
        <MoneyField label="Cash received" cents={d.cashCents} onChange={(c) => setD({ ...d, cashCents: c })} />
        {d.fromStatement && <><MoneyField label="Franked amount" cents={d.frankedCents} onChange={(c) => setD({ ...d, frankedCents: c })} /><MoneyField label="Unfranked amount" cents={d.unfrankedCents} onChange={(c) => setD({ ...d, unfrankedCents: c })} /><MoneyField label="Franking credit" cents={d.frankingCreditsCents} onChange={(c) => setD({ ...d, frankingCreditsCents: c })} /></>}
      </div>
      <Checkbox label="These figures are from the dividend statement" checked={d.fromStatement} onChange={(v) => setD({ ...d, fromStatement: v })} hint="Franking credits are only used when they come from a statement — they are never worked out from the cash received." />
      <ErrorText error={save.error} />
    </Dialog>
  );
}

function BrokerImport({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [preview, setPreview] = useState<ApiOutput<'investments.chooseTradesCsv'>>(null);
  const [accountId, setAccount] = useState<string | null>(null);
  const choose = useAction(async () => setPreview(await api('investments.chooseTradesCsv')));
  const ok = preview?.rows.filter((r) => !r.problems.length && r.date && r.type) ?? [];
  const commit = useAction(async () => { const r = await api('investments.commitTrades', { rows: ok.map((r) => ({ date: r.date!, code: r.code, type: r.type!, quantity: r.quantity, unitPriceCents: r.unitPriceCents, brokerageCents: r.brokerageCents })), accountId }); toast(`${r.added} trade(s) imported${r.skipped ? `, ${r.skipped} already recorded` : ''}.`, 'success'); onClose(); });
  return (
    <Dialog title="Import broker trade history" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>{preview && <button className="btn btn-primary" disabled={!ok.length} onClick={() => commit.run()}>Import {ok.length} trade(s)</button>}</>}>
      <div className="stack">
        <p className="small">A CSV with columns like Date, Code, Type (Buy/Sell), Quantity, Price and Brokerage.</p>
        <div className="row"><button className="btn" onClick={() => choose.run()}>Choose CSV…</button><AccountSelect label="Broker account (optional)" value={accountId} onChange={setAccount} allowNone types={['brokerage', 'brokerage-cash']} /></div>
        <ErrorText error={choose.error ?? commit.error} />
        {preview && (
          <DataTable rows={preview.rows} rowKey={(r) => String(r.row)} maxHeight={360} columns={[
            { key: 'r', header: 'Row', render: (r) => r.row },
            { key: 'd', header: 'Date', render: (r) => <DateText date={r.date} /> },
            { key: 'c', header: 'Code', render: (r) => r.code },
            { key: 't', header: 'Type', render: (r) => r.type ?? '?' },
            { key: 'q', header: 'Units', num: true, render: (r) => r.quantity },
            { key: 'p', header: 'Price', num: true, render: (r) => <Money cents={r.unitPriceCents} /> },
            { key: 'b', header: 'Brokerage', num: true, render: (r) => <Money cents={r.brokerageCents} /> },
            { key: 'x', header: '', render: (r) => (r.problems.length ? <Badge kind="warn">Skipped: {r.problems.join(', ')}</Badge> : <Badge kind="ok">OK</Badge>) },
          ]} />
        )}
      </div>
    </Dialog>
  );
}

export function Investments() {
  const current = financialYearOf(todayLocal());
  const [fy, setFy] = useState(current);
  const q = useApi('investments.overview', { fy }, [fy]);
  const [tab, setTab] = useState<'holdings' | 'trades' | 'dividends' | 'cgt'>('holdings');
  const [dialog, setDialog] = useState<'trade' | 'dividend' | 'import' | 'value' | null>(null);
  const [val, setVal] = useState({ securityId: '', date: todayLocal() as string | null, price: null as number | null });
  if (!q.data) return <Loading />;
  const ov = q.data;
  const code = new Map(ov.securities.map((s) => [s.id, s.code]));
  const totalValue = ov.holdings.reduce((a, h) => a + (h.valueCents ?? 0), 0);
  return (
    <Page title="Investments" intro={ov.note}
      actions={<><SelectField label="Financial year" value={fy} onChange={setFy} options={[current, previousFy(current), previousFy(previousFy(current))].map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} /><button className="btn" onClick={() => setDialog('import')}>Import broker CSV</button><button className="btn btn-primary" onClick={() => setDialog('trade')}>Record trade</button></>}>
      <Card>
        <div className="grid grid-4">
          <Stat label="Holdings" value={ov.holdings.length} />
          <Stat label="Value (your prices)" value={<Money cents={totalValue} />} note="Using prices you entered, with their dates" />
          <Stat label={`Dividends FY ${fyDisplay(fy)}`} value={<Money cents={ov.dividendTotals.cashCents} />} />
          <Stat label="Franking credits" value={<Money cents={ov.dividendTotals.frankingCreditsCents} />} note="From dividend statements only" />
        </div>
      </Card>
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ value: 'holdings', label: 'Holdings' }, { value: 'trades', label: 'Trades' }, { value: 'dividends', label: 'Dividends' }, { value: 'cgt', label: 'Capital gains' }]} />
      {tab === 'holdings' && (
        <Card actions={<button className="btn btn-sm" disabled={!ov.securities.length} onClick={() => { setVal({ ...val, securityId: ov.securities[0]?.id ?? '' }); setDialog('value'); }}>Enter a price</button>}>
          <DataTable rows={ov.holdings} rowKey={(h) => h.security.id} empty={<p className="muted">No holdings. Record trades or import broker history.</p>} columns={[
            { key: 'c', header: 'Security', render: (h) => <span><strong>{h.security.code}</strong> <span className="muted small">{h.security.name}</span></span> },
            { key: 'u', header: 'Units', num: true, render: (h) => h.quantity.toLocaleString('en-AU') },
            { key: 'b', header: 'Cost base', num: true, render: (h) => (h.costBaseCents === null ? <Badge kind="warn">Unknown</Badge> : <Money cents={h.costBaseCents} />) },
            { key: 'v', header: 'Value', num: true, render: (h) => (h.valueCents === null ? '—' : <span><Money cents={h.valueCents} /><div className="muted small">price as at <DateText date={h.valuationDate} /></div></span>) },
            { key: 'd', header: 'Difference', num: true, render: (h) => (h.unrealisedCents === null ? '—' : <Money cents={h.unrealisedCents} signed />) },
          ]} />
        </Card>
      )}
      {tab === 'trades' && (
        <Card>
          <DataTable rows={[...ov.trades].reverse()} rowKey={(t) => t.id} empty={<p className="muted">No trades recorded.</p>} columns={[
            { key: 'd', header: 'Date', render: (t) => <DateText date={t.date} /> },
            { key: 'c', header: 'Code', render: (t) => code.get(t.securityId) },
            { key: 't', header: 'Trade', render: (t) => (t.type === 'buy' ? 'Buy' : 'Sell') },
            { key: 'q', header: 'Units', num: true, render: (t) => t.quantity },
            { key: 'p', header: 'Price', num: true, render: (t) => (t.costUnknown ? <Badge kind="warn">Cost unknown</Badge> : <Money cents={Math.round(t.unitPriceCents)} />) },
            { key: 'b', header: 'Brokerage', num: true, render: (t) => <Money cents={t.brokerageCents} /> },
            { key: 'x', header: '', render: (t) => <button className="btn btn-ghost btn-sm" onClick={() => api('investments.deleteTrade', { id: t.id })}>Delete</button> },
          ]} />
        </Card>
      )}
      {tab === 'dividends' && (
        <Card actions={<button className="btn btn-sm" disabled={!ov.securities.length} onClick={() => setDialog('dividend')}>Record dividend</button>}>
          <p className="small muted" style={{ marginBottom: 8 }}>{ov.dividendTotals.explanation}</p>
          <DataTable rows={[...ov.dividends].reverse()} rowKey={(d) => d.id} empty={<p className="muted">No dividends recorded.</p>} columns={[
            { key: 'd', header: 'Paid', render: (d) => <DateText date={d.paymentDate} /> },
            { key: 'c', header: 'Code', render: (d) => code.get(d.securityId) },
            { key: 'a', header: 'Cash', num: true, render: (d) => <Money cents={d.cashCents} /> },
            { key: 'f', header: 'Franked', num: true, render: (d) => <Money cents={d.frankedCents} /> },
            { key: 'u', header: 'Unfranked', num: true, render: (d) => <Money cents={d.unfrankedCents} /> },
            { key: 'k', header: 'Franking credit', num: true, render: (d) => <Money cents={d.frankingCreditsCents} /> },
            { key: 's', header: 'Source', render: (d) => (d.fromStatement ? <Badge kind="ok">Statement</Badge> : <Badge kind="warn">Cash only</Badge>) },
            { key: 'x', header: '', render: (d) => <button className="btn btn-ghost btn-sm" onClick={() => api('investments.deleteDividend', { id: d.id })}>Delete</button> },
          ]} />
        </Card>
      )}
      {tab === 'cgt' && (
        <Card title={`Capital gains — FY ${fyDisplay(fy)}`} sub="Basic estimate from your trade records. CGT is complex — confirm with your tax agent.">
          {ov.capitalGains.missing.length > 0 && <Callout kind="warn" title="CGT estimate unavailable until cost-base information is provided">{ov.capitalGains.missing.join(' ')}</Callout>}
          <DataTable rows={ov.capitalGains.events} rowKey={(e) => `${e.disposalId}-${e.parcelId}`} empty={<p className="muted">No disposals in this financial year.</p>} columns={[
            { key: 'd', header: 'Sold', render: (e) => <DateText date={e.date} /> },
            { key: 'c', header: 'Code', render: (e) => code.get(e.securityId) },
            { key: 'q', header: 'Units', num: true, render: (e) => e.quantity },
            { key: 'p', header: 'Proceeds', num: true, render: (e) => <Money cents={e.proceedsCents} /> },
            { key: 'b', header: 'Cost base', num: true, render: (e) => (e.costBaseCents === null ? <Badge kind="warn">Missing</Badge> : <Money cents={e.costBaseCents} />) },
            { key: 'g', header: 'Gain / loss', num: true, render: (e) => (e.gainCents === null ? '—' : <Money cents={e.gainCents} signed />) },
            { key: 'h', header: 'Held 12+ months', render: (e) => (e.discountEligible ? 'Yes' : 'No') },
          ]} />
          {ov.capitalGains.netCapitalGainCents !== null && ov.capitalGains.events.length > 0 && (
            <div className="grid grid-3" style={{ marginTop: 12 }}>
              <Stat label="Capital gains" value={<Money cents={ov.capitalGains.grossGainsCents} />} />
              <Stat label="Discount" value={<Money cents={ov.capitalGains.discountCents} />} />
              <Stat label="Estimated net capital gain" value={<Money cents={ov.capitalGains.netCapitalGainCents} />} />
            </div>
          )}
          <Explain><p>{ov.capitalGains.explanation}</p><p>The 50% discount applies to assets owned at least 12 months, not counting the day bought or the day of the sale (contract) date.</p></Explain>
        </Card>
      )}
      {dialog === 'trade' && <TradeForm ov={ov} onClose={() => setDialog(null)} />}
      {dialog === 'dividend' && <DividendForm ov={ov} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <BrokerImport onClose={() => setDialog(null)} />}
      {dialog === 'value' && (
        <Dialog title="Enter a price" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!val.price || !val.date} onClick={async () => { await api('investments.saveValuation', { securityId: val.securityId, date: val.date!, unitPriceCents: val.price! }); setDialog(null); }}>Save</button></>}>
          <div className="form-grid">
            <SelectField label="Security" value={val.securityId} onChange={(v) => setVal({ ...val, securityId: v })} options={ov.securities.map((s) => ({ value: s.id, label: s.code }))} />
            <DateField label="Price as at" value={val.date} onChange={(v) => setVal({ ...val, date: v })} />
            <MoneyField label="Price per unit" cents={val.price} onChange={(c) => setVal({ ...val, price: c })} />
          </div>
          <p className="small muted">Geranium does not fetch market prices. Values are shown with the date of the price you enter.</p>
        </Dialog>
      )}
    </Page>
  );
}
