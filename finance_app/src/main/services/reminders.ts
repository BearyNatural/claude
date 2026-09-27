import { Ctx, getSettings } from './core';
import { listLoans } from './planning';
import { ISODate, addDays, diffDays, financialYearOf, fyDisplay, formatDate, parts, startOfWeek } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { Frequency } from '../../domain/periods';
import { occurrences } from '../../domain/schedule';
import { ReminderType } from '../../shared/types';

/**
 * Works out which optional reminders are due. Delivery is a local desktop notification;
 * no server is involved. Amounts are left out of notification text unless the user opts in,
 * because notifications can appear on a locked screen.
 */

export interface Reminder {
  key: string;
  type: ReminderType;
  title: string;
  body: string;
  route: string;
}

const INSURANCE = /insurance/;

export function dueReminders(ctx: Ctx, now: { date: ISODate; time: string }): Reminder[] {
  const s = getSettings(ctx);
  const n = s.notifications;
  if (!n.enabled || now.time < n.preferredTime) return [];
  const today = now.date;
  const out: Reminder[] = [];
  const amt = (c: number) => (n.showAmounts ? ` (${formatMoney(c)})` : '');
  const repeatSuffix = n.allowRepeat ? `:${today}` : '';
  const on = (t: ReminderType) => n.types[t]?.enabled;
  const days = (t: ReminderType) => n.types[t]?.daysBefore ?? 0;
  const when = (d: ISODate) => {
    const k = diffDays(today, d);
    return k === 0 ? 'today' : k === 1 ? 'tomorrow' : k < 0 ? `${-k} day${k === -1 ? '' : 's'} ago` : `on ${formatDate(d)}`;
  };

  for (const b of ctx.db.all('SELECT * FROM bills WHERE active = 1 AND reminder_enabled = 1')) {
    const isIns = INSURANCE.test(String(b.category_id ?? '')) || /insurance/i.test(String(b.name));
    const type: ReminderType = isIns ? 'insurance' : 'bills';
    if (!on(type)) continue;
    const lead = isIns ? Math.max(days('insurance'), Number(b.reminder_days)) : Number(b.reminder_days ?? days('bills'));
    const due = String(b.next_due);
    if (diffDays(today, due) <= lead && diffDays(today, due) >= -3) {
      out.push({ key: `${type}:${b.id}:${due}${repeatSuffix}`, type, title: isIns ? 'Insurance renewal coming up' : 'Bill due', body: `${b.name} is due ${when(due)}${amt(Number(b.amount_cents))}.${b.auto_pay ? ' It is set to pay automatically.' : ''}`, route: 'bills' });
    }
  }
  if (on('termDeposits')) {
    for (const t of ctx.db.all("SELECT * FROM term_deposits WHERE status = 'active'")) {
      const m = String(t.maturity_date);
      const lead = Math.max(Number(t.reminder_days ?? 0), days('termDeposits'));
      if (diffDays(today, m) <= lead && diffDays(today, m) >= 0) {
        out.push({ key: `td:${t.id}:${m}${repeatSuffix}`, type: 'termDeposits', title: 'Term deposit maturing', body: `Your ${t.institution} term deposit${amt(Number(t.principal_cents))} matures ${when(m)}. Check its rollover instructions with the institution if needed.`, route: 'term-deposits' });
      }
    }
  }
  if (on('annualExpense')) {
    for (const f of ctx.db.all('SELECT * FROM sinking_funds')) {
      const due = String(f.due_date);
      if (diffDays(today, due) <= days('annualExpense') && diffDays(today, due) >= 0) {
        out.push({ key: `sinking:${f.id}:${due}${repeatSuffix}`, type: 'annualExpense', title: 'Annual expense coming up', body: `${f.name} is expected ${when(due)}${amt(Number(f.target_cents))}.`, route: 'bills' });
      }
    }
  }
  if (on('mortgage')) {
    for (const l of listLoans(ctx).filter((x) => x.kind === 'mortgage' && x.repaymentCents)) {
      const next = occurrences({ frequency: l.frequency as Frequency, anchor: l.asOf }, addDays(today, 0), addDays(today, 40)).find((d) => d !== l.asOf);
      if (next && diffDays(today, next) <= days('mortgage')) {
        out.push({ key: `loan:${l.id}:${next}${repeatSuffix}`, type: 'mortgage', title: 'Mortgage repayment', body: `${l.name} repayment ${when(next)}${amt(l.repaymentCents ?? 0)}.`, route: 'loans' });
      }
    }
  }
  if (on('taxReview')) {
    const { m } = parts(today);
    if (m >= 7 && m <= 10) {
      // July–October: the financial year that ended on 30 June.
      const ended = financialYearOf(`${parts(today).y}-06-30`);
      out.push({ key: `tax:${ended}`, type: 'taxReview', title: 'Tax time', body: `The ${fyDisplay(ended)} financial year has ended. You can review your tax estimate and export records for your tax agent.`, route: 'tax' });
    }
  }
  if (on('goals') && parts(today).d === 1) {
    out.push({ key: `goals:${today.slice(0, 7)}`, type: 'goals', title: 'Monthly goal check-in', body: 'Your savings goals have been updated with the latest balances.', route: 'goals' });
  }
  if (on('backup')) {
    const last = s.lastBackupAt ? s.lastBackupAt.slice(0, 10) : null;
    const every = Math.max(1, days('backup'));
    if (!last || diffDays(last, today) >= every) {
      out.push({ key: `backup:${startOfWeek(today)}`, type: 'backup', title: 'Backup reminder', body: last ? `Your last encrypted backup was on ${formatDate(last)}.` : 'You have not made an encrypted backup yet.', route: 'backup' });
    }
  }
  const sent = new Set(ctx.db.all('SELECT key FROM reminders_sent').map((r) => String(r.key)));
  return out.filter((r) => !sent.has(r.key));
}

export function markRemindersSent(ctx: Ctx, keys: string[]): void {
  for (const k of keys) ctx.db.run('INSERT OR IGNORE INTO reminders_sent(key, sent_at) VALUES(?, ?)', [k, ctx.now()]);
}
