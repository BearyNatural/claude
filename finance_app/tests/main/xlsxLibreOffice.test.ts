import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workbookToXlsx } from '@domain/output/xlsx';
import { readDelimited } from '@domain/import/csv';
import { budgetVsActualSheet, spendingByCategorySheet, taxSheet, transactionsSheet, termDepositsSheet } from '@domain/output/sheets';

function hasSoffice(): boolean {
  try {
    execFileSync('soffice', ['--version'], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a generated workbook in LibreOffice (a different spreadsheet program) and reads the
 * recalculated results, proving the formulas work outside Paperbark. Skipped when LibreOffice
 * is not installed.
 */
describe.skipIf(!hasSoffice())('generated XLSX recalculates in LibreOffice', () => {
  it('computes SUMIFS, differences, tax brackets and term-deposit interest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paperbark-xlsx-'));
    try {
      const wb = {
        title: 'Check', createdAt: '2026-09-27', sheets: [
          transactionsSheet([
            { date: '2026-09-01', account: 'A', description: 'W', payee: '', category: 'Groceries', group: 'Food', amountCents: -12643, type: 'Expense' as const, incomeType: '', tags: '', business: '', notes: '' },
            { date: '2026-09-02', account: 'A', description: 'C', payee: '', category: 'Groceries', group: 'Food', amountCents: -5000, type: 'Expense' as const, incomeType: '', tags: '', business: '', notes: '' },
            { date: '2026-09-03', account: 'A', description: 'P', payee: '', category: 'Salary', group: 'Income', amountCents: 410217, type: 'Income' as const, incomeType: 'Salary', tags: '', business: '', notes: '' },
          ]),
          spendingByCategorySheet([{ group: 'Food', category: 'Groceries' }], 3),
          budgetVsActualSheet('Sep', [{ category: 'Groceries', budgetCents: 90000, actualCents: 84200 }]),
          taxSheet('2026–27', [{ label: 'Salary', amountCents: 9000000 }], 9000000, [{ over: 18200, rate: 0.15 }, { over: 45000, rate: 0.3 }, { over: 135000, rate: 0.37 }, { over: 190000, rate: 0.45 }], 'x', []),
          termDepositsSheet([{ institution: 'Bank', principalCents: 5000000, start: '2026-09-01', maturity: '2027-09-01', ratePercent: 4.5, interestCents: 225000, maturityValueCents: 5225000, frequency: 'At maturity' }]),
        ],
      };
      const file = join(dir, 'check.xlsx');
      writeFileSync(file, workbookToXlsx(wb));
      execFileSync('soffice', [
        `-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to',
        'csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,true,false,false,false,-1', file, '--outdir', dir,
      ], { stdio: 'ignore', timeout: 120000 });
      const read = (name: string) => {
        const f = readdirSync(dir).find((x) => x.startsWith('check-') && x.includes(name) && x.endsWith('.csv'));
        return readDelimited(readFileSync(join(dir, f!), 'utf8'));
      };
      const expenses = read('Expenses');
      expect(expenses[1][2]).toBe('176.43');
      const bva = read('Budget');
      expect(bva[1][3]).toBe('58');
      const tax = read('Tax');
      expect(tax.find((r) => r[0].startsWith('Income tax'))?.[1]).toBe('17520');
      const td = read('Term');
      expect(td[1][5]).toBe('365');
      expect(td[1][6]).toBe('2250');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});
