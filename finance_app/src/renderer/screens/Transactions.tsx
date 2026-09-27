import { useEffect, useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateField, DateText, Dialog, Drawer, ErrorText, Icon, Loading, Money, MoneyField, NumberField, Page, SelectField, TextField, useConfirm } from '../components/ui';
import { AccountSelect, CategorySelect, RangePicker, RangePreset, presetRange, todayLocal } from '../components/pickers';
import { INCOME_TYPE_LABEL, IncomeType } from '@domain/categorise/categories';
import { GST_CLASS_LABEL, GstClass } from '@domain/tax/gst';
import { formatDate } from '@domain/dates';
import { formatMoney } from '@domain/money';
import type { TransactionDTO } from '../../shared/types';
import type { ApiInput } from '../../main/api';

const SOURCE_LABEL: Record<string, string> = { user: 'You', rule: 'Rule', history: 'Past choices', none: '' };

export function RuleSuggestionCallout({ suggestion, onDone }: { suggestion: { pattern: string; categoryId: string; key?: string; count?: number }; onDone: () => void }) {
  const { toast } = useApp();
  const [apply, setApply] = useState(true);
  const cats = useApi('categories.list', {}, []);
  const name = cats.data?.find((c) => c.id === suggestion.categoryId)?.name ?? suggestion.categoryId;
  return (
    <Callout title="Create a rule?">
      <div className="stack">
        <span>Always categorise transactions containing “{suggestion.pattern}” as {name}?</span>
        <Checkbox label="Also apply to existing transactions (not ones you categorised by hand)" checked={apply} onChange={setApply} />
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={async () => { const r = await api('rules.acceptSuggestion', { pattern: suggestion.pattern, categoryId: suggestion.categoryId, applyToExisting: apply }); toast(`Rule created${r.updated ? `; ${r.updated} transaction(s) updated` : ''}.`, 'success'); onDone(); }}>Create rule</button>
          <button className="btn btn-sm" onClick={async () => { await api('rules.dismissSuggestion', { key: suggestion.key ?? suggestion.pattern, categoryId: suggestion.categoryId }); onDone(); }}>Not now</button>
        </div>
      </div>
    </Callout>
  );
}

function SplitEditor({ tx, onDone }: { tx: TransactionDTO; onDone: () => void }) {
  const [parts, setParts] = useState<{ categoryId: string | null; amountCents: number | null; note: string }[]>(
    tx.splits.length ? tx.splits.map((s) => ({ categoryId: s.categoryId, amountCents: Math.abs(s.amountCents), note: s.note ?? '' })) : [{ categoryId: tx.categoryId, amountCents: Math.abs(tx.amountCents), note: '' }, { categoryId: null, amountCents: 0, note: '' }],
  );
  const sign = tx.amountCents < 0 ? -1 : 1;
  const total = parts.reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const left = Math.abs(tx.amountCents) - total;
  const save = useAction(async (clear?: boolean) => {
    await api('transactions.setSplits', { id: tx.id, parts: clear ? [] : parts.map((p) => ({ categoryId: p.categoryId, amountCents: sign * (p.amountCents ?? 0), note: p.note || null })) });
    onDone();
  });
  return (
    <div className="stack">
      <p className="small muted">The transaction stays {formatMoney(Math.abs(tx.amountCents))}. Parts must add up to exactly that amount.</p>
      {parts.map((p, i) => (
        <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
          <CategorySelect value={p.categoryId} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))} />
          <MoneyField label="Amount" cents={p.amountCents} onChange={(c) => setParts(parts.map((x, j) => (j === i ? { ...x, amountCents: c } : x)))} />
          <button className="btn btn-ghost btn-sm" onClick={() => setParts(parts.filter((_, j) => j !== i))} disabled={parts.length <= 2}>Remove</button>
        </div>
      ))}
      <div className="row-between">
        <button className="btn btn-sm" onClick={() => setParts([...parts, { categoryId: null, amountCents: Math.max(0, left), note: '' }])}><Icon name="plus" size={14} /> Add part</button>
        <span className={left === 0 ? 'small' : 'small'} role="status">{left === 0 ? 'Parts add up exactly.' : `${formatMoney(Math.abs(left))} ${left > 0 ? 'still to allocate' : 'too much'}`}</span>
      </div>
      <ErrorText error={save.error} />
      <div className="form-actions">
        {tx.splits.length > 0 && <button className="btn" onClick={() => save.run(true)}>Remove split</button>}
        <button className="btn btn-primary" disabled={left !== 0 || save.pending} onClick={() => save.run()}>Save split</button>
      </div>
    </div>
  );
}

function TransactionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { toast } = useApp();
  const q = useApi('transactions.get', { id }, [id]);
  const [suggestion, setSuggestion] = useState<{ pattern: string; categoryId: string; key: string } | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [tagText, setTagText] = useState('');
  const confirm = useConfirm();
  const tx = q.data?.transaction;
  useEffect(() => setTagText(tx?.tags.join(', ') ?? ''), [tx?.id, tx?.tags.join(',')]);
  if (!tx) return <Drawer title="Transaction" onClose={onClose}><Loading /></Drawer>;
  const update = async (patch: ApiInput<'transactions.update'>['patch']) => {
    try {
      const r = await api('transactions.update', { id: tx.id, patch });
      if (r.ruleSuggestion) setSuggestion(r.ruleSuggestion);
      if (r.learnedRuleCreated) toast('A rule was learned from your corrections (automatic learning is on).', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Drawer title={tx.cleanDescription} onClose={onClose}>
      <div className="stack-lg">
        <div className="row-between">
          <div>
            <div className="stat-value"><Money cents={tx.amountCents} signed /></div>
            <div className="muted small"><DateText date={tx.date} long />{tx.processingDate ? ` · processed ${formatDate(tx.processingDate)}` : ''} · {tx.accountName}</div>
          </div>
          <div className="row">{tx.status === 'staged' && <Badge kind="warn">Waiting for review</Badge>}{tx.isTransfer && <Badge kind="info">Transfer</Badge>}{tx.isOneOff && <Badge>One-off</Badge>}</div>
        </div>
        {suggestion && <RuleSuggestionCallout suggestion={suggestion} onDone={() => setSuggestion(null)} />}
        <Card title="Category">
          {tx.splits.length ? (
            <div className="stack">
              <ul className="list-plain small">{tx.splits.map((s) => <li key={s.id} className="row-between"><span>{s.categoryName ?? 'Uncategorised'}</span><Money cents={s.amountCents} /></li>)}</ul>
              <button className="btn btn-sm" onClick={() => setSplitting(true)}>Edit split</button>
            </div>
          ) : tx.isTransfer ? (
            <div className="stack">
              <p>This is a transfer between your own accounts, so it is not counted as income or spending.</p>
              {tx.transferId && <button className="btn btn-sm" onClick={async () => { await api('transfers.unlink', { transferId: tx.transferId! }); q.reload(); }}>Unlink transfer</button>}
            </div>
          ) : (
            <div className="stack">
              <CategorySelect value={tx.categoryId} onChange={(v) => update({ categoryId: v })} />
              {tx.categoryExplanation && <span className="muted small">{tx.categoryExplanation}</span>}
              <div className="row">
                <button className="btn btn-sm" onClick={() => setSplitting(true)}><Icon name="split" size={14} /> Split across categories</button>
                <button className="btn btn-sm" onClick={async () => { await api('transfers.link', { outId: tx.id, inId: null, note: 'Transfer to an account not tracked in Paperbark' }); q.reload(); }}>Mark as transfer to my own account</button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Details">
          <div className="form-grid">
            <div className="field"><label htmlFor="clean-desc">Description</label><input id="clean-desc" className="input" defaultValue={tx.cleanDescription} onBlur={(e) => e.target.value.trim() && e.target.value !== tx.cleanDescription && update({ cleanDescription: e.target.value.trim() })} /></div>
            <SelectField label="Income type" value={tx.incomeType ?? ''} placeholder="Not income" onChange={(v) => update({ incomeType: (v || null) as IncomeType | null })} options={Object.entries(INCOME_TYPE_LABEL).map(([value, label]) => ({ value: value as IncomeType, label }))} />
            <SelectField label="Tax" value={tx.taxClass ?? 'none'} onChange={(v) => update({ taxClass: v as TransactionDTO['taxClass'] })} options={[{ value: 'none', label: 'Not tax-related' }, { value: 'deductible', label: 'Tax deductible (personal)' }, { value: 'business-income', label: 'Business income' }, { value: 'private', label: 'Private' }]} />
            <SelectField label="Use" value={tx.businessUse ?? 'personal'} onChange={(v) => update({ businessUse: v as TransactionDTO['businessUse'], businessPercent: v === 'mixed' ? tx.businessPercent ?? 50 : null })} options={[{ value: 'personal', label: 'Personal' }, { value: 'business', label: 'Business' }, { value: 'mixed', label: 'Mixed business & personal' }]} />
            {tx.businessUse === 'mixed' && <NumberField label="Business share" suffix="%" value={tx.businessPercent} min={0} max={100} onChange={(v) => v !== null && update({ businessPercent: v })} hint="Keep a note of how you worked this out." />}
            <SelectField label="GST" value={tx.gstClass ?? ''} placeholder="Not set" onChange={(v) => update({ gstClass: (v || null) as GstClass | null })} options={Object.entries(GST_CLASS_LABEL).map(([value, label]) => ({ value: value as GstClass, label }))} />
          </div>
          <div className="stack" style={{ marginTop: 10 }}>
            <Checkbox label="One-off (leave out of averages and cost of living)" checked={tx.isOneOff} onChange={(v) => update({ isOneOff: v })} />
            <div className="field"><label htmlFor="tags">Tags</label><input id="tags" className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={() => update({ tags: tagText.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="e.g. property, holiday" /></div>
            <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" className="input" defaultValue={tx.notes ?? ''} onBlur={(e) => e.target.value !== (tx.notes ?? '') && update({ notes: e.target.value || null })} /></div>
          </div>
        </Card>
        <Card title="Supporting documents" actions={<button className="btn btn-sm" onClick={async () => { try { await api('documents.attach', { kind: 'receipt', link: { entity: 'transaction', entityId: tx.id } }); q.reload(); } catch (e) { toast((e as Error).message, 'error'); } }}><Icon name="paperclip" size={14} /> Attach</button>}>
          {q.data!.documents.length ? <ul className="list-plain">{q.data!.documents.map((d) => <li key={d.id} className="row-between"><span>{d.fileName} <span className="muted small">· {d.kind}</span></span><button className="btn btn-sm" onClick={() => api('documents.open', { id: d.id })}>Open</button></li>)}</ul> : <p className="muted small">Receipts, invoices and statements can be attached. They are stored encrypted on this computer.</p>}
        </Card>
        <Card title="Where this came from">
          <dl className="kv small">
            <dt>Original description</dt><dd><code>{tx.originalDescription}</code></dd>
            {tx.reference && <><dt>Reference</dt><dd>{tx.reference}</dd></>}
            {tx.externalId && <><dt>Bank transaction ID</dt><dd>{tx.externalId}</dd></>}
            {tx.balanceCents !== null && <><dt>Balance after (statement)</dt><dd><Money cents={tx.balanceCents} /></dd></>}
            <dt>Import confidence</dt><dd>{tx.confidence ?? '—'}</dd>
          </dl>
          {tx.reviewReasons.length > 0 && <ul className="small">{tx.reviewReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <details className="explain" style={{ marginTop: 8 }}><summary>Original imported row</summary><pre className="explain-body small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(tx.originalData, null, 2)}</pre></details>
        </Card>
        <Card title="Change history">
          {q.data!.history.length ? (
            <ul className="list-plain small">{q.data!.history.map((h) => <li key={h.id}><strong>{h.field}</strong>: {h.oldValue ?? '—'} → {h.newValue ?? '—'}<div className="muted">{h.reason} · {formatDate(h.createdAt.slice(0, 10))}</div></li>)}</ul>
          ) : <p className="muted small">No changes recorded.</p>}
        </Card>
        <div><button className="btn btn-danger btn-sm" onClick={async () => { if (await confirm.ask('Delete this transaction?', <p>It will be removed from your records. The change is recorded in the history. If it came from an import, importing the same file again may bring it back.</p>, 'Delete', true)) { await api('transactions.delete', { id: tx.id }); onClose(); } }}>Delete transaction</button></div>
      </div>
      {splitting && <Dialog title="Split transaction" onClose={() => setSplitting(false)}><SplitEditor tx={tx} onDone={() => { setSplitting(false); q.reload(); }} /></Dialog>}
      {confirm.node}
    </Drawer>
  );
}

function AddManual({ onClose }: { onClose: () => void }) {
  const [accountId, setAccount] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(todayLocal());
  const [amount, setAmount] = useState<number | null>(null);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const save = useAction(async () => {
    await api('transactions.addManual', { accountId: accountId ?? '', date: date ?? '', amountCents: (dir === 'out' ? -1 : 1) * Math.abs(amount ?? 0), description: desc, categoryId: cat });
    onClose();
  });
  return (
    <Dialog title="Add a transaction" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.pending} onClick={() => save.run()}>Add</button></>}>
      <div className="form-grid">
        <AccountSelect value={accountId} onChange={setAccount} />
        <DateField label="Date" value={date} onChange={setDate} />
        <SelectField label="Money" value={dir} onChange={setDir} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} />
        <MoneyField label="Amount" cents={amount} onChange={setAmount} />
        <TextField label="Description" value={desc} onChange={setDesc} />
        <CategorySelect value={cat} onChange={setCat} />
      </div>
      <ErrorText error={save.error} />
    </Dialog>
  );
}

export function Transactions() {
  const { params, toast } = useApp();
  const today = todayLocal();
  const [search, setSearch] = useState(params.search ?? '');
  const [applied, setApplied] = useState(params.search ?? '');
  const [accountId, setAccountId] = useState<string | null>(params.accountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [preset, setPreset] = useState<RangePreset>(params.search ? 'last-2-years' : 'rolling-12');
  const [custom, setCustom] = useState({ start: today, end: today });
  const [limit, setLimit] = useState(200);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [suggestion, setSuggestion] = useState<{ pattern: string; categoryId: string; key: string } | null>(null);
  useEffect(() => {
    if (params.search !== undefined) { setSearch(params.search); setApplied(params.search); setPreset('last-2-years'); }
    if (params.accountId) setAccountId(params.accountId);
    if (params.categoryId) setCategoryId(params.categoryId);
  }, [params]);
  // A plain-English search sets its own dates; otherwise use the period picker.
  const range = presetRange(preset, today, custom);
  const hasDateWords = /\b(last|this|since|before|fy|financial year|in (19|20)\d\d)\b/i.test(applied);
  const q = useApi('transactions.list', { status: 'posted', accountId, categoryId, from: hasDateWords ? null : range.start, to: hasDateWords ? null : range.end, search: applied || null, limit }, [accountId, categoryId, range.start, range.end, applied, limit, hasDateWords]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = q.data?.rows ?? [];
  return (
    <Page title="Transactions" intro="Approved transactions from your imports and manual entries. Imported descriptions are kept exactly as received." actions={<><button className="btn" onClick={() => setAdding(true)}>Add manually</button></>}>
      <Card>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); setApplied(search); setLimit(200); }}>
          <div className="field" style={{ flex: 2, minWidth: 260 }}>
            <label htmlFor="tx-search">Search</label>
            <input id="tx-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder='e.g. "woolworths", "over $500", "dividend income this financial year", "tag:property"' />
          </div>
          <button className="btn">Search</button>
          {applied && <button type="button" className="btn btn-ghost" onClick={() => { setSearch(''); setApplied(''); }}>Clear</button>}
        </form>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}><AccountSelect label="Account" value={accountId} onChange={setAccountId} allowNone placeholder="All accounts" /></div>
          <div style={{ minWidth: 240 }}><CategorySelect label="Category" value={categoryId} onChange={setCategoryId} allowNone noneLabel="All categories" /></div>
          {!hasDateWords && <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
        </div>
        {q.data && q.data.chips.length > 0 && <div className="row" style={{ marginTop: 10 }} aria-label="How your search was understood"><span className="muted small">Understood as:</span>{q.data.chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
      </Card>
      {suggestion && <RuleSuggestionCallout suggestion={suggestion} onDone={() => setSuggestion(null)} />}
      {selected.size > 0 && (
        <Card>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <strong>{selected.size} selected</strong>
            <div style={{ minWidth: 260 }}><CategorySelect label="Set category" value={bulkCat} onChange={setBulkCat} /></div>
            <button className="btn btn-primary" onClick={async () => { const r = await api('transactions.bulkUpdate', { ids: [...selected], patch: { categoryId: bulkCat } }); if (r.ruleSuggestion) setSuggestion(r.ruleSuggestion); toast(`${r.updated} transaction(s) updated.`, 'success'); setSelected(new Set()); }}>Apply category</button>
            <button className="btn" onClick={async () => { await api('transactions.bulkUpdate', { ids: [...selected], patch: { businessUse: 'business' } }); setSelected(new Set()); }}>Mark business</button>
            <button className="btn" onClick={async () => { await api('transactions.bulkUpdate', { ids: [...selected], patch: { businessUse: 'personal' } }); setSelected(new Set()); }}>Mark personal</button>
            <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        </Card>
      )}
      <Card title={q.data ? `${q.data.total.toLocaleString('en-AU')} transaction${q.data.total === 1 ? '' : 's'}` : 'Transactions'} sub={q.data ? <>Net total <Money cents={q.data.totalAmountCents} signed /></> : undefined}>
        {!q.data ? <Loading /> : (
          <>
            <DataTable rows={rows} rowKey={(t) => t.id} onRowClick={(t) => setOpen(t.id)} caption="Transactions" empty={<p className="muted">No transactions match.</p>} columns={[
              { key: 's', header: '', width: '32px', render: (t) => <input type="checkbox" aria-label={`Select ${t.cleanDescription}`} checked={selected.has(t.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(t.id)} /> },
              { key: 'd', header: 'Date', sort: (t) => t.date, render: (t) => <DateText date={t.date} /> },
              { key: 'desc', header: 'Description', sort: (t) => t.cleanDescription, render: (t) => <span title={t.originalDescription}>{t.cleanDescription}{t.splits.length > 0 && <Badge>Split</Badge>}{t.documentCount > 0 && <span title="Has documents"> <Icon name="paperclip" size={12} /></span>}<div className="muted small">{t.accountName}</div></span> },
              { key: 'c', header: 'Category', sort: (t) => t.categoryPath ?? '', render: (t) => t.isTransfer ? <Badge kind="info">Transfer</Badge> : t.splits.length ? <span className="muted small">{t.splits.length} categories</span> : t.categoryName ? <span>{t.categoryName}{t.categorySource && SOURCE_LABEL[t.categorySource] ? <span className="muted small"> · {SOURCE_LABEL[t.categorySource]}</span> : null}</span> : <Badge kind="warn">Uncategorised</Badge> },
              { key: 'a', header: 'Amount', num: true, sort: (t) => t.amountCents, render: (t) => <Money cents={t.amountCents} signed /> },
            ]} />
            {q.data.total > rows.length && <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button className="btn" onClick={() => setLimit(limit + 400)}>Show more ({q.data.total - rows.length} more)</button></div>}
          </>
        )}
      </Card>
      {open && <TransactionDrawer id={open} onClose={() => setOpen(null)} />}
      {adding && <AddManual onClose={() => setAdding(false)} />}
    </Page>
  );
}
