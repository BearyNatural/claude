import { useId, useMemo } from 'react';
import { useShared } from '../lib/api';
import { Field, SelectField } from './ui';
import { ACCOUNT_TYPE_LABEL } from '@domain/accounts';
import { addMonths, addDays, financialYearOf, fyRange, fyDisplay, previousFy, startOfMonth, endOfMonth, parts, makeDate } from '@domain/dates';
import type { CategoryDTO } from '../../shared/types';

export function useCategories() {
  const data = useShared('categories.list', ['categories']);
  const cats = data ?? [];
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  return { cats, byId };
}

export function useAccounts() {
  const data = useShared('accounts.list', ['accounts', 'transactions']);
  return { accounts: data ?? [], loading: data === undefined };
}

const KIND_GROUP: Record<CategoryDTO['kind'], string> = { expense: 'Spending', income: 'Income', transfer: 'Transfers', savings: 'Savings', investment: 'Investments', super: 'Superannuation' };

export function CategorySelect({ label = 'Category', value, onChange, allowNone = true, noneLabel = 'Uncategorised', kinds, hint, hideLabel }: { label?: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; noneLabel?: string; kinds?: CategoryDTO['kind'][]; hint?: string; hideLabel?: boolean }) {
  const { cats } = useCategories();
  const id = useId();
  const list = cats.filter((c) => !kinds || kinds.includes(c.kind));
  const groups = Object.entries(KIND_GROUP).filter(([k]) => list.some((c) => c.kind === k));
  return (
    <Field label={label || 'Category'} hint={hint} htmlFor={id} hideLabel={hideLabel || !label}>
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {allowNone && <option value="">{noneLabel}</option>}
        {groups.map(([k, g]) => (
          <optgroup key={k} label={g}>
            {list.filter((c) => c.kind === k).map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

export function AccountSelect({ label = 'Account', value, onChange, allowNone, types, placeholder }: { label?: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; types?: string[]; placeholder?: string }) {
  const { accounts } = useAccounts();
  const list = accounts.filter((a) => a.status !== 'archived' && (!types || types.includes(a.type)));
  return (
    <SelectField label={label} value={value ?? ''} onChange={(v) => onChange(v || null)} placeholder={allowNone ? placeholder ?? 'None' : placeholder ?? 'Choose an account'}
      options={list.map((a) => ({ value: a.id, label: `${a.name}${a.numberMasked ? ` (${a.numberMasked})` : ''}`, group: ACCOUNT_TYPE_LABEL[a.type] }))} />
  );
}

export type RangePreset = 'this-month' | 'last-month' | 'last-3-months' | 'this-fy' | 'last-fy' | 'rolling-12' | 'this-year' | 'last-2-years' | 'custom';

export function presetRange(p: RangePreset, today: string, custom?: { start: string; end: string }): { start: string; end: string; label: string } {
  const fy = financialYearOf(today);
  switch (p) {
    case 'this-month': return { start: startOfMonth(today), end: today, label: 'This month' };
    case 'last-month': { const s = addMonths(startOfMonth(today), -1); return { start: s, end: endOfMonth(s), label: 'Last month' }; }
    case 'last-3-months': return { start: addMonths(startOfMonth(today), -3), end: addDays(startOfMonth(today), -1), label: 'Last 3 full months' };
    case 'this-fy': return { ...fyRange(fy), end: today, label: `FY ${fyDisplay(fy)} to date` };
    case 'last-fy': return { ...fyRange(previousFy(fy)), label: `FY ${fyDisplay(previousFy(fy))}` };
    case 'this-year': return { start: makeDate(parts(today).y, 1, 1), end: today, label: `${parts(today).y} to date` };
    case 'last-2-years': return { start: addDays(addMonths(today, -24), 1), end: today, label: 'Last 2 years' };
    case 'custom': return { start: custom?.start ?? addMonths(today, -1), end: custom?.end ?? today, label: 'Custom' };
    default: return { start: addDays(addMonths(today, -12), 1), end: today, label: 'Rolling 12 months' };
  }
}

export function RangePicker({ preset, onPreset, custom, onCustom }: { preset: RangePreset; onPreset: (p: RangePreset) => void; custom: { start: string; end: string }; onCustom: (c: { start: string; end: string }) => void }) {
  const id = useId();
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <div className="field" style={{ minWidth: 200 }}>
        <label htmlFor={id}>Period</label>
        <select id={id} className="input" value={preset} onChange={(e) => onPreset(e.target.value as RangePreset)}>
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="last-3-months">Last 3 full months</option>
          <option value="rolling-12">Rolling 12 months</option>
          <option value="this-fy">This financial year to date</option>
          <option value="last-fy">Last financial year</option>
          <option value="this-year">This calendar year</option>
          <option value="last-2-years">Last 2 years</option>
          <option value="custom">Custom…</option>
        </select>
      </div>
      {preset === 'custom' && (
        <>
          <div className="field"><label htmlFor={`${id}-s`}>From</label><input id={`${id}-s`} className="input" type="date" value={custom.start} onChange={(e) => e.target.value && onCustom({ ...custom, start: e.target.value })} /></div>
          <div className="field"><label htmlFor={`${id}-e`}>To</label><input id={`${id}-e`} className="input" type="date" value={custom.end} onChange={(e) => e.target.value && onCustom({ ...custom, end: e.target.value })} /></div>
        </>
      )}
    </div>
  );
}

export function FySelect({ value, onChange, years }: { value: string; onChange: (fy: string) => void; years: string[] }) {
  return <SelectField label="Financial year" value={value} onChange={onChange} options={years.map((y) => ({ value: y, label: `FY ${fyDisplay(y)}` }))} />;
}

export function todayLocal(): string {
  const n = new Date();
  return makeDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}
