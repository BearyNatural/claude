import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ctx, UserError, str } from './core';
import { open, seal, sha256 } from '../crypto/crypto';

/**
 * Supporting documents (receipts, statements, payslips…) stored inside the app's data folder,
 * each encrypted with the database key. The original file is kept byte-for-byte so it can be
 * handed to an accountant; nothing is uploaded anywhere.
 */

export type DocumentKind =
  | 'receipt' | 'invoice' | 'tax-invoice' | 'bank-statement' | 'dividend-statement' | 'interest-statement'
  | 'payslip' | 'broker-statement' | 'super-statement' | 'other';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receipt: 'Receipt', invoice: 'Invoice', 'tax-invoice': 'Tax invoice', 'bank-statement': 'Bank statement', 'dividend-statement': 'Dividend statement',
  'interest-statement': 'Interest statement', payslip: 'Payslip', 'broker-statement': 'Broker statement', 'super-statement': 'Super statement', other: 'Other',
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  csv: 'text/csv', txt: 'text/plain', ofx: 'application/x-ofx', qfx: 'application/x-ofx', qif: 'application/qif',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function mimeFor(fileName: string): string {
  return MIME[fileName.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream';
}

export class DocumentStore {
  private key: Buffer | null;

  constructor(readonly dir: string, key: Buffer) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.key = Buffer.from(key);
  }

  private path(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid document id');
    return join(this.dir, `${id}.bin`);
  }

  put(id: string, bytes: Uint8Array): void {
    if (!this.key) throw new Error('Documents are locked');
    writeFileSync(this.path(id), seal(this.key, bytes, Buffer.from(id)), { mode: 0o600 });
  }

  get(id: string): Buffer {
    if (!this.key) throw new Error('Documents are locked');
    const p = this.path(id);
    if (!existsSync(p)) throw new UserError('The stored file for this document is missing.');
    return open(this.key, readFileSync(p), Buffer.from(id));
  }

  remove(id: string): void {
    rmSync(this.path(id), { force: true });
  }

  ids(): string[] {
    return existsSync(this.dir) ? readdirSync(this.dir).filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4)) : [];
  }

  lock(): void {
    if (this.key) this.key.fill(0);
    this.key = null;
  }
}

export interface DocumentDTO {
  id: string;
  fileName: string;
  mime: string | null;
  size: number;
  sha256: string;
  kind: DocumentKind;
  notes: string | null;
  createdAt: string;
  links: { entity: string; entityId: string; label: string }[];
}

function linkLabel(ctx: Ctx, entity: string, entityId: string): string {
  if (entity === 'transaction') {
    const t = ctx.db.get('SELECT date, clean_description, amount_cents FROM transactions WHERE id = ?', [entityId]);
    return t ? `${t.date} ${t.clean_description} ${(Number(t.amount_cents) / 100).toFixed(2)}` : 'Deleted transaction';
  }
  if (entity === 'import') return `Import: ${ctx.db.scalar('SELECT file_name FROM imports WHERE id = ?', [entityId]) ?? 'removed'}`;
  if (entity === 'payslip') return `Payslip: ${ctx.db.scalar("SELECT employer || ' ' || pay_date FROM payslips WHERE id = ?", [entityId]) ?? 'removed'}`;
  if (entity === 'dividend') return 'Dividend statement';
  if (entity === 'tax-entry') return `Tax record: ${ctx.db.scalar('SELECT description FROM tax_entries WHERE id = ?', [entityId]) ?? 'removed'}`;
  return entity;
}

export function listDocuments(ctx: Ctx, entity?: string, entityId?: string): DocumentDTO[] {
  const rows = entity && entityId
    ? ctx.db.all('SELECT d.* FROM documents d JOIN document_links l ON l.document_id = d.id WHERE l.entity = ? AND l.entity_id = ? ORDER BY d.created_at DESC', [entity, entityId])
    : ctx.db.all('SELECT * FROM documents ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: String(r.id), fileName: String(r.file_name), mime: str(r.mime), size: Number(r.size), sha256: String(r.sha256), kind: r.kind as DocumentKind,
    notes: str(r.notes), createdAt: String(r.created_at),
    links: ctx.db.all('SELECT entity, entity_id FROM document_links WHERE document_id = ?', [String(r.id)]).map((l) => ({ entity: String(l.entity), entityId: String(l.entity_id), label: linkLabel(ctx, String(l.entity), String(l.entity_id)) })),
  }));
}

export function addDocument(ctx: Ctx, store: DocumentStore, input: { fileName: string; bytes: Uint8Array; kind: DocumentKind; notes?: string | null; link?: { entity: string; entityId: string } | null }): string {
  if (input.bytes.byteLength > 100 * 1024 * 1024) throw new UserError('Files over 100 MB cannot be attached.');
  const hash = sha256(input.bytes);
  const existing = ctx.db.get('SELECT id FROM documents WHERE sha256 = ?', [hash]);
  const id = existing ? String(existing.id) : ctx.id();
  ctx.db.tx(() => {
    if (!existing) {
      store.put(id, input.bytes);
      ctx.db.run('INSERT INTO documents(id, file_name, mime, size, sha256, kind, notes, created_at) VALUES(?,?,?,?,?,?,?,?)',
        [id, input.fileName, mimeFor(input.fileName), input.bytes.byteLength, hash, input.kind, input.notes ?? null, ctx.now()]);
    }
    if (input.link) ctx.db.run('INSERT OR IGNORE INTO document_links(document_id, entity, entity_id) VALUES(?,?,?)', [id, input.link.entity, input.link.entityId]);
  });
  ctx.changed('documents');
  return id;
}

export function linkDocument(ctx: Ctx, documentId: string, entity: string, entityId: string): void {
  ctx.db.run('INSERT OR IGNORE INTO document_links(document_id, entity, entity_id) VALUES(?,?,?)', [documentId, entity, entityId]);
  ctx.changed('documents');
}

export function unlinkDocument(ctx: Ctx, documentId: string, entity: string, entityId: string): void {
  ctx.db.run('DELETE FROM document_links WHERE document_id = ? AND entity = ? AND entity_id = ?', [documentId, entity, entityId]);
  ctx.changed('documents');
}

export function updateDocument(ctx: Ctx, id: string, patch: { kind?: DocumentKind; notes?: string | null; fileName?: string }): void {
  if (patch.kind) ctx.db.run('UPDATE documents SET kind = ? WHERE id = ?', [patch.kind, id]);
  if (patch.notes !== undefined) ctx.db.run('UPDATE documents SET notes = ? WHERE id = ?', [patch.notes, id]);
  if (patch.fileName?.trim()) ctx.db.run('UPDATE documents SET file_name = ? WHERE id = ?', [patch.fileName.trim(), id]);
  ctx.changed('documents');
}

export function readDocument(ctx: Ctx, store: DocumentStore, id: string): { fileName: string; mime: string; bytes: Buffer } {
  const r = ctx.db.get('SELECT file_name, mime, sha256 FROM documents WHERE id = ?', [id]);
  if (!r) throw new UserError('That document no longer exists.');
  const bytes = store.get(id);
  if (sha256(bytes) !== r.sha256) throw new UserError('The stored copy of this document does not match its original fingerprint.');
  return { fileName: String(r.file_name), mime: String(r.mime ?? 'application/octet-stream'), bytes };
}

export function deleteDocument(ctx: Ctx, store: DocumentStore, id: string): void {
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM document_links WHERE document_id = ?', [id]);
    ctx.db.run('DELETE FROM documents WHERE id = ?', [id]);
    ctx.db.run('UPDATE imports SET document_id = NULL WHERE document_id = ?', [id]);
  });
  store.remove(id);
  ctx.changed('documents');
}
