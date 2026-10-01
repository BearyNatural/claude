import { useState } from 'react';
import { api, IS_WEB, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, DataTable, DateText, Dialog, Empty, Loading, Page, SelectField, TextField, useConfirm } from '../components/ui';

export function Documents() {
  const { toast, status } = useApp();
  const q = useApi('documents.list', undefined, []);
  const kinds = useApi('documents.kinds', undefined, []);
  const [kind, setKind] = useState('receipt');
  const [edit, setEdit] = useState<{ id: string; notes: string; kind: string } | null>(null);
  const confirm = useConfirm();
  const kindOptions = Object.entries(kinds.data ?? {}).map(([value, label]) => ({ value, label: String(label) }));
  return (
    <Page title="Documents" intro={`Receipts, invoices, statements and other source records, stored encrypted ${IS_WEB ? 'in this browser' : 'on this computer'} and linked to transactions or imports. Optional for everyday budgeting; useful for business and tax records.`}
      actions={<><SelectField label="Type" value={kind} onChange={setKind} options={kindOptions} /><button className="btn btn-primary" disabled={status?.demo} onClick={async () => { try { await api('documents.attach', { kind: kind as never }); } catch (e) { toast((e as Error).message, 'error'); } }}>Add document…</button></>}>
      {status?.demo && <Callout kind="neutral">Documents cannot be added in demo mode.</Callout>}
      {!q.data ? <Loading /> : !q.data.length ? <Card><Empty title="No documents yet">Attach a receipt from a transaction’s details, keep the original file when importing a statement, or add documents here.</Empty></Card> : (
        <Card>
          <DataTable rows={q.data} rowKey={(d) => d.id} columns={[
            { key: 'n', header: 'File', render: (d) => <span>{d.fileName}<div className="muted small">{(d.size / 1024).toFixed(0)} KB · added <DateText date={d.createdAt.slice(0, 10)} /></div></span> },
            { key: 'k', header: 'Type', render: (d) => <Badge kind="outline">{String(kinds.data?.[d.kind as keyof typeof kinds.data] ?? d.kind)}</Badge> },
            { key: 'l', header: 'Linked to', render: (d) => (d.links.length ? <ul className="list-plain small">{d.links.map((l) => <li key={l.entity + l.entityId}>{l.label}</li>)}</ul> : <span className="muted small">Not linked</span>) },
            { key: 'o', header: 'Notes', render: (d) => <span className="small">{d.notes}</span> },
            { key: 'x', header: '', render: (d) => (
              <span className="row">
                <button className="btn btn-sm" onClick={() => api('documents.open', { id: d.id })}>Open</button>
                <button className="btn btn-sm" onClick={async () => { const p = await api('documents.saveCopy', { id: d.id }); if (p) toast(`Saved a copy to ${p}`, 'success'); }}>Save copy</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: d.id, notes: d.notes ?? '', kind: d.kind })}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm.ask('Delete document?', <p>“{d.fileName}” will be permanently removed from Geranium. Make sure you have another copy if it is a tax record you must keep.</p>, 'Delete', true)) await api('documents.delete', { id: d.id }); }}>Delete</button>
              </span>) },
          ]} />
        </Card>
      )}
      <Callout kind="neutral">Opening a document creates a temporary decrypted copy so another program can show it. Geranium deletes these copies when it locks or closes. Imported transactions do not replace original records — keep source documents that the ATO requires.</Callout>
      {edit && (
        <Dialog title="Edit document" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={async () => { await api('documents.update', { id: edit.id, kind: edit.kind, notes: edit.notes || null }); setEdit(null); }}>Save</button></>}>
          <div className="form-grid">
            <SelectField label="Type" value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={kindOptions} />
            <TextField label="Notes" value={edit.notes} onChange={(v) => setEdit({ ...edit, notes: v })} />
          </div>
        </Dialog>
      )}
      {confirm.node}
    </Page>
  );
}
