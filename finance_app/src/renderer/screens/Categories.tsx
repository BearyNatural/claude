import type { ReactElement } from 'react';
import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, DataTable, DateText, Dialog, ErrorText, Loading, Money, MoneyField, NumberField, Page, SelectField, Tabs, TextField, useConfirm } from '../components/ui';
import { AccountSelect, CategorySelect, useCategories } from '../components/pickers';
import { INCOME_TYPE_LABEL, IncomeType } from '@domain/categorise/categories';
import type { CategoryDTO } from '../../shared/types';

function CategoryForm({ initial, onClose }: { initial?: CategoryDTO; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [parentId, setParent] = useState<string | null>(initial?.parentId ?? null);
  const [kind, setKind] = useState<CategoryDTO['kind']>(initial?.kind ?? 'expense');
  const [nature, setNature] = useState<CategoryDTO['nature']>(initial?.nature ?? 'variable');
  const save = useAction(async () => { await api('categories.save', { id: initial?.id, name, parentId, kind, nature: kind === 'expense' ? nature : null }); onClose(); });
  return (
    <Dialog title={initial ? 'Edit category' : 'New category'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()} onClick={() => save.run()}>Save</button></>}>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} autoFocus />
        <CategorySelect label="Inside (optional)" value={parentId} onChange={setParent} allowNone />
        <SelectField label="Type" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }, { value: 'savings', label: 'Savings' }, { value: 'investment', label: 'Investments' }, { value: 'transfer', label: 'Transfer' }]} />
        {kind === 'expense' && <SelectField label="Nature" value={nature ?? 'variable'} onChange={(v) => setNature(v as CategoryDTO['nature'])} options={[{ value: 'fixed', label: 'Fixed (bills, contracts)' }, { value: 'variable', label: 'Variable (everyday)' }, { value: 'discretionary', label: 'Discretionary (optional)' }]} hint="Used to group the cost of living." />}
      </div>
      <ErrorText error={save.error} />
    </Dialog>
  );
}

function CategoryList() {
  const { toast } = useApp();
  const all = useApi('categories.list', { includeArchived: true }, []);
  const [edit, setEdit] = useState<CategoryDTO | 'new' | null>(null);
  if (!all.data) return <Loading />;
  const kids = (id: string | null) => all.data!.filter((c) => c.parentId === id && !c.archived);
  const renderTree = (id: string | null, depth: number): ReactElement[] =>
    kids(id).flatMap((c) => [
      <li key={c.id} className="row-between" style={{ paddingLeft: depth * 22 }}>
        <span>{c.name} {c.isDefault ? null : <Badge kind="accent">Yours</Badge>} {c.nature && depth === 0 ? <span className="muted small">· {c.nature}</span> : null}</span>
        <span className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}>Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => { const r = await api('categories.remove', { id: c.id }); toast(r.archived ? `“${c.name}” is in use, so it was archived rather than deleted.` : `“${c.name}” deleted.`); }}>Remove</button>
        </span>
      </li>,
      ...renderTree(c.id, depth + 1),
    ]);
  const archived = all.data.filter((c) => c.archived);
  return (
    <Card title="Categories" actions={<button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}>New category</button>}>
      <ul className="list-plain">{renderTree(null, 0)}</ul>
      {archived.length > 0 && <details className="explain" style={{ marginTop: 10 }}><summary>{archived.length} archived</summary><ul className="explain-body list-plain">{archived.map((c) => <li key={c.id} className="row-between">{c.path}<button className="btn btn-sm" onClick={() => api('categories.restore', { id: c.id })}>Restore</button></li>)}</ul></details>}
      {edit && <CategoryForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function RuleForm({ onClose }: { onClose: () => void }) {
  const [field, setField] = useState<'description' | 'payee'>('description');
  const [matchType, setMatch] = useState<'contains' | 'word' | 'starts-with' | 'equals' | 'wildcard' | 'regex'>('contains');
  const [pattern, setPattern] = useState('');
  const [direction, setDir] = useState<'any' | 'in' | 'out'>('any');
  const [min, setMin] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const [accountId, setAccount] = useState<string | null>(null);
  const [categoryId, setCat] = useState<string | null>(null);
  const [incomeType, setIncome] = useState<IncomeType | ''>('');
  const [business, setBusiness] = useState<'' | 'personal' | 'business' | 'mixed'>('');
  const [pct, setPct] = useState<number | null>(null);
  const [apply, setApply] = useState(true);
  const save = useAction(async () => {
    const id = await api('rules.save', { field, matchType, pattern, direction, amountMinCents: min, amountMaxCents: max, accountId, categoryId, incomeType: incomeType || null, businessUse: business || null, businessPercent: business === 'mixed' ? pct : null, priority: 0, enabled: true });
    if (apply) await api('rules.apply', { ruleId: id });
    onClose();
  });
  return (
    <Dialog title="New rule" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!pattern.trim()} onClick={() => save.run()}>Save rule</button></>}>
      <div className="stack">
        <div className="form-grid">
          <SelectField label="When the" value={field} onChange={setField} options={[{ value: 'description', label: 'Description' }, { value: 'payee', label: 'Payee' }]} />
          <SelectField label="Match" value={matchType} onChange={setMatch} options={[{ value: 'contains', label: 'contains' }, { value: 'word', label: 'contains the word' }, { value: 'starts-with', label: 'starts with' }, { value: 'equals', label: 'is exactly' }, { value: 'wildcard', label: 'matches (use * as a wildcard)' }, { value: 'regex', label: 'matches a regular expression' }]} />
          <TextField label="Text" value={pattern} onChange={setPattern} placeholder="e.g. WOOLWORTHS" />
          <SelectField label="Direction" value={direction} onChange={setDir} options={[{ value: 'any', label: 'Money in or out' }, { value: 'out', label: 'Money out only' }, { value: 'in', label: 'Money in only' }]} />
          <MoneyField label="Amount at least (optional)" cents={min} onChange={setMin} />
          <MoneyField label="Amount at most (optional)" cents={max} onChange={setMax} />
          <AccountSelect label="Only in account (optional)" value={accountId} onChange={setAccount} allowNone placeholder="Any account" />
        </div>
        <h3>Then</h3>
        <div className="form-grid">
          <CategorySelect label="Set category" value={categoryId} onChange={setCat} />
          <SelectField label="Set income type" value={incomeType} onChange={setIncome} placeholder="Leave unchanged" options={Object.entries(INCOME_TYPE_LABEL).map(([value, label]) => ({ value: value as IncomeType, label }))} />
          <SelectField label="Set use" value={business} onChange={setBusiness} placeholder="Leave unchanged" options={[{ value: 'personal', label: 'Personal' }, { value: 'business', label: 'Business' }, { value: 'mixed', label: 'Mixed' }]} />
          {business === 'mixed' && <NumberField label="Business share" suffix="%" value={pct} onChange={setPct} min={0} max={100} />}
        </div>
        <Checkbox label="Apply to existing transactions now" checked={apply} onChange={setApply} hint="Transactions you categorised by hand are never changed by rules." />
        <ErrorText error={save.error} />
      </div>
    </Dialog>
  );
}

function Rules() {
  const { toast } = useApp();
  const q = useApi('rules.list', undefined, []);
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState<'mine' | 'all'>('mine');
  if (!q.data) return <Loading />;
  const rows = q.data.filter((r) => show === 'all' || r.source !== 'default');
  return (
    <Card title="Rules" sub="Rules run in this order: yours, then learned, then built-in. A category you choose by hand is never overridden."
      actions={<><button className="btn btn-sm" onClick={async () => { const r = await api('rules.apply', { onlyUncategorised: false }); toast(`${r.updated} transaction(s) updated by rules.`); }}>Re-apply rules</button><button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>New rule</button></>}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="segmented" role="group" aria-label="Which rules"><button aria-pressed={show === 'mine'} onClick={() => setShow('mine')}>Yours and learned</button><button aria-pressed={show === 'all'} onClick={() => setShow('all')}>Include built-in ({q.data.filter((r) => r.source === 'default').length})</button></div>
      </div>
      <DataTable rows={rows} rowKey={(r) => r.id} maxHeight={560} empty={<p className="muted">No rules of your own yet. Built-in rules still categorise common Australian merchants.</p>} columns={[
        { key: 'src', header: 'Source', render: (r) => <Badge kind={r.source === 'user' ? 'accent' : r.source === 'learned' ? 'info' : 'outline'}>{{ user: 'Yours', learned: 'Learned', default: 'Built-in' }[r.source]}</Badge> },
        { key: 'd', header: 'When', render: (r) => <span className="small">{r.description}</span> },
        { key: 'c', header: 'Then', render: (r) => <span className="small">{r.categoryName ?? '—'}{r.incomeType ? ` · ${INCOME_TYPE_LABEL[r.incomeType]}` : ''}</span> },
        { key: 'h', header: 'Used', num: true, render: (r) => r.hitCount },
        { key: 'e', header: 'On', render: (r) => <input type="checkbox" aria-label={`Rule enabled: ${r.description}`} checked={r.enabled} onChange={(e) => api('rules.setEnabled', { id: r.id, enabled: e.target.checked })} /> },
        { key: 'x', header: '', render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => api('rules.delete', { id: r.id })}>{r.source === 'default' ? 'Turn off' : 'Delete'}</button> },
      ]} />
      {adding && <RuleForm onClose={() => setAdding(false)} />}
    </Card>
  );
}

function Suggestions() {
  const { settings, setSettings, toast } = useApp();
  const q = useApi('rules.suggestions', undefined, []);
  const [apply, setApply] = useState(true);
  return (
    <Card title="Learning from your corrections" sub="When you change the same merchant to the same category more than once, Geranium offers a rule. It is only created if you agree.">
      <div className="stack">
        {settings && (
          <div className="row">
            <Checkbox label="Create learned rules automatically (without asking)" checked={settings.autoLearnRules} onChange={async (v) => setSettings(await api('settings.update', { autoLearnRules: v }))} />
            <NumberField label="Corrections before suggesting" value={settings.learningThreshold} min={2} max={10} step="1" onChange={async (v) => v && setSettings(await api('settings.update', { learningThreshold: Math.max(2, Math.round(v)) }))} />
          </div>
        )}
        {!q.data?.length ? <p className="muted">No suggestions right now.</p> : (
          <>
            <Checkbox label="Also apply accepted rules to existing transactions" checked={apply} onChange={setApply} />
            <ul className="list-plain">
              {q.data.map((s) => (
                <li key={s.key + s.categoryId} className="row-between">
                  <span>{s.message}<div className="muted small">Based on {s.count} corrections, e.g. {s.examples.join('; ')}</div></span>
                  <span className="row">
                    <button className="btn btn-sm btn-primary" onClick={async () => { const r = await api('rules.acceptSuggestion', { pattern: s.pattern, categoryId: s.categoryId, applyToExisting: apply }); toast(`Rule created${r.updated ? ` and ${r.updated} transaction(s) updated` : ''}.`, 'success'); }}>Create rule</button>
                    <button className="btn btn-sm" onClick={() => api('rules.dismissSuggestion', { key: s.key, categoryId: s.categoryId })}>No thanks</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function Transfers() {
  const q = useApi('transfers.suggestions', undefined, []);
  if (!q.data) return <Loading />;
  return (
    <Card title="Transfers between your accounts" sub="Money leaving one of your accounts and arriving in another is one transfer — not spending plus income.">
      {!q.data.length ? <p className="muted">No unmatched transfers found. You can also mark a single transaction as a transfer from its details.</p> : (
        <DataTable rows={q.data} rowKey={(t) => t.outId + t.inId} columns={[
          { key: 'a', header: 'Amount', num: true, render: (t) => <Money cents={t.amountCents} /> },
          { key: 'o', header: 'From', render: (t) => <span>{t.out.accountName}<div className="muted small"><DateText date={t.out.date} /> · {t.out.cleanDescription}</div></span> },
          { key: 'i', header: 'To', render: (t) => <span>{t.in.accountName}<div className="muted small"><DateText date={t.in.date} /> · {t.in.cleanDescription}</div></span> },
          { key: 'c', header: 'Match', render: (t) => <Badge kind={t.confidence === 'high' ? 'ok' : 'warn'}>{t.confidence}</Badge> },
          { key: 'x', header: '', render: (t) => <span className="row"><button className="btn btn-sm btn-primary" onClick={() => api('transfers.link', { outId: t.outId, inId: t.inId, note: null })}>Link</button><button className="btn btn-sm" onClick={() => api('transfers.dismiss', { outId: t.outId, inId: t.inId })}>Not a transfer</button></span> },
        ]} />
      )}
    </Card>
  );
}

export function Categories() {
  const { params } = useApp();
  const [tab, setTab] = useState<'categories' | 'rules' | 'suggestions' | 'transfers'>((params.tab as 'transfers') ?? 'categories');
  const s = useApi('rules.suggestions', undefined, []);
  const t = useApi('transfers.suggestions', undefined, []);
  const confirm = useConfirm();
  useCategories();
  return (
    <Page title="Categories & rules" intro="Categories are yours to change. Rules are always visible, editable and removable — Geranium prefers clear rules over guesswork.">
      <Tabs label="Sections" value={tab} onChange={setTab} tabs={[{ value: 'categories', label: 'Categories' }, { value: 'rules', label: 'Rules' }, { value: 'suggestions', label: 'Suggestions', count: s.data?.length }, { value: 'transfers', label: 'Transfers', count: t.data?.length }]} />
      {tab === 'categories' && <CategoryList />}
      {tab === 'rules' && <Rules />}
      {tab === 'suggestions' && <Suggestions />}
      {tab === 'transfers' && <Transfers />}
      <Callout kind="neutral">Default categories and built-in merchant rules are a starting point. Removing a category that has been used archives it, so past transactions keep their history.</Callout>
      {confirm.node}
    </Page>
  );
}
