import { ReactNode, useEffect, useId, useRef, useState, KeyboardEvent as RKE } from 'react';
import { formatMoney, parseMoney } from '@domain/money';
import { formatDate, relativeDays } from '@domain/dates';
import { useApp } from '../lib/app';
import type { DataStatus } from '../../shared/types';

/* ------------------------------ icons ------------------------------ */

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M17 13h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
  tag: 'M3 12V3h9l9 9-9 9zM8 8h.01',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  pie: 'M21 12a9 9 0 1 1-9-9v9zM12 3a9 9 0 0 1 9 9',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  bank: 'M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3',
  calc: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  umbrella: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v7a2 2 0 0 1-4 0',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 3.9M6.1 6.1C3.3 7.9 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 5.9-1.9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  chevron: 'M9 18l6-6-6-6',
  split: 'M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 12v9',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  paperclip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  sheet: 'M4 3h16v18H4zM4 9h16M4 15h16M10 3v18',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
};

export function Icon({ name, size = 18, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

/* ------------------------------ values ------------------------------ */

export function Money({ cents, signed, whole, className }: { cents: number | null | undefined; signed?: boolean; whole?: boolean; className?: string }) {
  const { privacy } = useApp();
  if (cents === null || cents === undefined) return <span className={className}>—</span>;
  if (privacy) return <span className={`privacy-dot ${className ?? ''}`} aria-label="Amount hidden">$•••••</span>;
  return <span className={`num ${className ?? ''}`}>{formatMoney(cents, { signed, wholeDollars: whole })}</span>;
}

export function useMoneyText() {
  const { privacy } = useApp();
  return (cents: number | null | undefined, opts: { signed?: boolean; whole?: boolean } = {}) =>
    cents === null || cents === undefined ? '—' : privacy ? '$•••••' : formatMoney(cents, { signed: opts.signed, wholeDollars: opts.whole });
}

export function DateText({ date, long }: { date: string | null | undefined; long?: boolean }) {
  return <span className="nowrap">{formatDate(date, { long })}</span>;
}

export function Percent({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span>—</span>;
  return <span className="num">{(value * 100).toFixed(digits)}%</span>;
}

const STATUS_LABEL: Record<DataStatus, string> = {
  actual: 'Actual', imported: 'Imported', 'user-entered': 'Entered by you', inferred: 'Inferred', forecast: 'Forecast', estimate: 'Estimate', hypothetical: 'Hypothetical', calculated: 'Calculated',
};

export function StatusBadge({ status }: { status: DataStatus }) {
  const cls = status === 'forecast' || status === 'hypothetical' ? 'badge-info' : status === 'estimate' || status === 'inferred' ? 'badge-warn' : 'badge-outline';
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status]}</span>;
}

/** Shows how current a figure is, so an old balance never looks live. */
export function Freshness({ date, source, today }: { date: string | null | undefined; source?: string | null; today: string }) {
  if (!date) return <span className="muted small">No date</span>;
  const age = Math.round((new Date(today).getTime() - new Date(date).getTime()) / 86400000);
  const stale = age > 31;
  return (
    <span className={`small ${stale ? '' : 'muted'}`} title={`As at ${formatDate(date, { long: true })}`}>
      {source ? `${source} · ` : ''}{age <= 0 ? 'as at today' : `last updated ${formatDate(date)}`} ({relativeDays(date, today)})
      {stale && <span className="badge badge-warn" style={{ marginLeft: 6 }}><Icon name="clock" size={12} /> Not current</span>}
    </span>
  );
}

/* ------------------------------ layout pieces ------------------------------ */

export function Page({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [title]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 tabIndex={-1} ref={ref}>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, sub, actions, children, className }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, hero }: { label: string; value: ReactNode; note?: ReactNode; hero?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={hero ? 'stat-hero' : 'stat-value'}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Callout({ kind = 'info', children, title }: { kind?: 'info' | 'warn' | 'danger' | 'ok' | 'neutral'; children: ReactNode; title?: string }) {
  const icon = kind === 'warn' || kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  return (
    <div className={`callout callout-${kind}`} role={kind === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} size={16} />
      <div>{title && <strong>{title}. </strong>}{children}</div>
    </div>
  );
}

export function Explain({ children, label = 'How was this calculated?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="explain">
      <summary><Icon name="info" size={14} /> {label}</summary>
      <div className="explain-body">{children}</div>
    </details>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="muted" role="status" aria-live="polite">{what}…</div>;
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <Callout kind="danger">{error}</Callout>;
}

export function Badge({ children, kind, className }: { children: ReactNode; kind?: 'info' | 'warn' | 'ok' | 'danger' | 'accent' | 'outline'; className?: string }) {
  return <span className={['badge', kind ? `badge-${kind}` : '', className ?? ''].filter(Boolean).join(' ')}>{children}</span>;
}

/* ------------------------------ inputs ------------------------------ */

export function Field({ label, hint, error, children, htmlFor, hideLabel }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; hideLabel?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function TextField({ label, value, onChange, hint, placeholder, type = 'text', required, autoFocus, maxLength }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; type?: string; required?: boolean; autoFocus?: boolean; maxLength?: number }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="input" type={type} value={value} placeholder={placeholder} required={required} autoFocus={autoFocus} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumberField({ label, value, onChange, hint, step = 'any', min, max, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: ReactNode; step?: string; min?: number; max?: number; suffix?: string }) {
  const id = useId();
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} hint={hint} htmlFor={id}>
      <input id={id} className="input num" type="number" inputMode="decimal" step={step} min={min} max={max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    </Field>
  );
}

/** Money input in dollars; value is cents. */
export function MoneyField({ label, cents, onChange, hint, allowNegative }: { label: string; cents: number | null; onChange: (c: number | null) => void; hint?: ReactNode; allowNegative?: boolean }) {
  const id = useId();
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const parsed = parseMoney(text);
    if ((parsed?.cents ?? null) !== cents) setText(cents === null ? '' : (cents / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <Field label={label} hint={hint} error={err} htmlFor={id}>
      <div className="input-money">
        <span aria-hidden="true">$</span>
        <input id={id} className="input num" inputMode="decimal" value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!text.trim()) { setErr(null); onChange(null); return; }
            const p = parseMoney(text);
            if (!p) { setErr('Enter an amount like 1234.56'); return; }
            if (!allowNegative && p.cents < 0) { setErr('Enter a positive amount'); return; }
            setErr(null);
            setText((p.cents / 100).toFixed(2));
            onChange(p.cents);
          }} />
      </div>
    </Field>
  );
}

export function DateField({ label, value, onChange, hint }: { label: string; value: string | null; onChange: (v: string | null) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, hint, placeholder }: { label: string; value: T | '' | null; onChange: (v: T) => void; options: { value: T; label: string; group?: string }[]; hint?: ReactNode; placeholder?: string }) {
  const id = useId();
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {groups.length > 1
          ? groups.map((g) => (
            <optgroup key={g} label={g}>
              {options.filter((o) => (o.group ?? '') === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))
          : options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; label: string }) {
  const onKey = (e: RKE<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
    if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.label}{t.count ? <span className="nav-count" style={{ marginLeft: 6 }}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ dialog & drawer ------------------------------ */

function useFocusTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), [tabindex]:not([tabindex="-1"])');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useFocusTrap(onClose);
  const id = useId();
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" data-close onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
        {footer && <div className="form-actions">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useFocusTrap(onClose);
  const id = useId();
  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" data-close onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, body: ReactNode, confirm = 'Confirm', danger = false) => new Promise<boolean>((resolve) => setState({ title, body, confirm, danger, resolve }));
  const node = state ? (
    <Dialog title={state.title} onClose={() => { state.resolve(false); setState(null); }}
      footer={<>
        <button className="btn" onClick={() => { state.resolve(false); setState(null); }}>Cancel</button>
        <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { state.resolve(true); setState(null); }}>{state.confirm}</button>
      </>}>
      <div className="stack">{state.body}</div>
    </Dialog>
  ) : null;
  return { ask, node };
}

/* ------------------------------ tables ------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  num?: boolean;
  sort?: (row: T) => string | number;
  width?: string;
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, caption, empty, selected, footer, maxHeight }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; caption?: string; empty?: ReactNode;
  selected?: string | null; footer?: ReactNode; maxHeight?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = sort ? columns.find((c) => c.key === sort.key) : null;
  const sorted = col?.sort ? [...rows].sort((a, b) => {
    const x = col.sort!(a), y = col.sort!(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir;
  }) : rows;
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined} style={c.width ? { width: c.width } : undefined} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                {c.sort ? <button className="table-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 1 ? -1 : 1 }))}>{c.header}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'clickable' : undefined} aria-selected={selected === rowKey(r) ? true : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}>
              {columns.map((c) => <td key={c.key} className={c.num ? 'num' : undefined}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
