import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, DataTable, DateText, Empty, Loading, Money, Page, useConfirm } from '../components/ui';
import { CategorySelect } from '../components/pickers';

export function Inbox() {
  const { toast, navigate } = useApp();
  const q = useApi('inbox.list', undefined, []);
  const transfers = useApi('transfers.suggestions', undefined, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!q.data) return <Loading />;
  const rows = q.data.rows.filter((r) => !reason || r.reviewReasons.some((x) => x.startsWith(reason)));
  const stagedIds = new Set(q.data.rows.map((r) => r.id));
  const relevantTransfers = (transfers.data ?? []).filter((t) => stagedIds.has(t.outId) || stagedIds.has(t.inId));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const approve = async (ids: string[]) => {
    for (const id of ids) {
      if (cats[id] !== undefined) await api('inbox.approve', { ids: [id], categoryId: cats[id] });
    }
    const rest = ids.filter((id) => cats[id] === undefined);
    if (rest.length) await api('inbox.approve', { ids: rest });
    setSelected(new Set());
    toast(`${ids.length} transaction${ids.length === 1 ? '' : 's'} approved.`, 'success');
  };
  return (
    <Page title="Review inbox" intro="Imported transactions wait here when something is uncertain. They are not included in budgets, reports or forecasts until you approve them."
      actions={q.data.count > 0 ? <button className="btn" onClick={async () => { const r = await api('inbox.approveObvious'); toast(r.approved ? `${r.approved} straightforward transaction(s) approved.` : 'Nothing straightforward to approve — each remaining item needs a decision.', 'info'); }}>Approve the straightforward ones</button> : undefined}>
      {q.data.count === 0 ? (
        <Card><Empty title="Nothing to review" action={<button className="btn" onClick={() => navigate('import')}>Import a file</button>}>New imports that need a decision will appear here.</Empty></Card>
      ) : (
        <>
          <div className="row" role="group" aria-label="Filter by reason">
            <button className="chip" aria-pressed={!reason} onClick={() => setReason(null)}>All ({q.data.count})</button>
            {Object.entries(q.data.byReason).map(([r, n]) => <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r} ({n})</button>)}
          </div>
          {relevantTransfers.length > 0 && (
            <Card title="Possible transfers between your accounts" sub="Linking makes both sides one transfer — not income and not spending">
              <ul className="list-plain">
                {relevantTransfers.map((t) => (
                  <li key={t.outId + t.inId} className="row-between">
                    <span><Money cents={t.amountCents} /> from <strong>{t.out.accountName}</strong> (<DateText date={t.out.date} />) to <strong>{t.in.accountName}</strong> (<DateText date={t.in.date} />)<div className="muted small">{t.reasons.join(', ')}</div></span>
                    <span className="row">
                      <button className="btn btn-sm btn-primary" onClick={async () => { await api('transfers.link', { outId: t.outId, inId: t.inId, note: null }); await api('inbox.approve', { ids: [t.outId, t.inId].filter((x) => stagedIds.has(x)) }); transfers.reload(); }}>Link as transfer</button>
                      <button className="btn btn-sm" onClick={async () => { await api('transfers.dismiss', { outId: t.outId, inId: t.inId }); transfers.reload(); }}>Not a transfer</button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {selected.size > 0 && (
            <Callout kind="neutral">
              <div className="row"><strong>{selected.size} selected</strong>
                <button className="btn btn-sm btn-primary" onClick={() => approve([...selected])}>Approve selected</button>
                <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirm.ask('Reject selected?', <p>{selected.size} imported transaction(s) will be removed. They never became part of your records.</p>, 'Reject', true)) { await api('inbox.reject', { ids: [...selected] }); setSelected(new Set()); } }}>Reject selected</button>
              </div>
            </Callout>
          )}
          <Card>
            <DataTable rows={rows} rowKey={(r) => r.id} caption="Transactions waiting for review" columns={[
              { key: 's', header: '', width: '32px', render: (r) => <input type="checkbox" aria-label={`Select ${r.cleanDescription}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> },
              { key: 'd', header: 'Date', render: (r) => <DateText date={r.date} /> },
              { key: 'desc', header: 'Transaction', render: (r) => <span>{r.cleanDescription}<div className="muted small">{r.accountName}</div>{r.reviewReasons.map((x) => <div key={x} style={{ marginTop: 4 }}><Badge kind={x.startsWith('Possible duplicate') ? 'warn' : 'info'} className="badge-wrap">{x}</Badge></div>)}</span> },
              { key: 'a', header: 'Amount', num: true, render: (r) => <Money cents={r.amountCents} signed /> },
              { key: 'c', header: 'Category', render: (r) => <div style={{ minWidth: 200 }}><CategorySelect hideLabel value={cats[r.id] !== undefined ? cats[r.id] : r.categoryId} onChange={(v) => setCats({ ...cats, [r.id]: v })} /></div> },
              { key: 'x', header: '', render: (r) => (
                <span className="row">
                  <button className="btn btn-sm btn-primary" onClick={() => approve([r.id])}>Approve</button>
                  <button className="btn btn-sm" onClick={async () => { await api('inbox.reject', { ids: [r.id] }); }}>Reject</button>
                </span>) },
            ]} />
          </Card>
        </>
      )}
      {confirm.node}
    </Page>
  );
}
