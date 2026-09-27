# How Paperbark calculates things

Every figure in the app has a **"How was this calculated?"** panel with the inputs for that figure. This page describes the methods behind those panels. The code lives in `src/domain/` and each method has unit tests in `tests/domain/`.

## Foundations

- **Money** is stored as integer cents. Rounding is half away from zero, once per step.
- **Periods:** week (starts Monday, or Sunday if chosen), fortnight (anchored to a date you choose, usually a payday), month, quarter, Australian financial year (1 July – 30 June) and calendar year. A period that includes today is labelled *in progress* and figures are "to date".
- **Frequency conversion** uses 52 weeks, 26 fortnights, 13 four-weekly periods, 12 months, 4 quarters, 2 half-years a year. $500 a fortnight = $500 × 26 ÷ 12 = $1,083.33 a month.
- **Transfers** between your own accounts are excluded from income and spending. **Split** transactions count each part in its own category. **One-off** transactions can be flagged so they are reported separately from regular costs.
- **Coverage:** analysis only uses the dates your imported statements actually cover. If you ask about a period with gaps, the result says which part is covered and warns about missing accounts or stale balances, instead of treating missing data as zero.

## Spending, income and averages

- **Period totals:** money in (income-kind categories and uncategorised credits), spending (expense-kind categories and uncategorised debits), net cash flow = money in − spending, and *moved to savings & investments* (transfers into savings, offset, term-deposit, brokerage and super accounts, plus savings-kind categories).
- **Savings rate** = (money in − spending) ÷ money in, shown only when money in is above zero.
- **Averages:** total ÷ number of days covered = per day; × 7 per week, × 14 per fortnight, × 365.25 ÷ 12 per month, × 365.25 ÷ 4 per quarter, × 365.25 per year. The panel states the transaction count, the dates and the number of weeks.
- **Comparisons** (period vs previous, vs same period last year, financial year vs previous) describe differences in neutral words — *"Groceries was $46.00 above the previous month"* — never "overspent" or "good/bad".

## True cost of living

For each category over the chosen range:

1. Take the total excluding one-offs (one-offs are listed separately).
2. Annualise: if the range is a year (365–366 days) use it as is, otherwise × 365.25 ÷ days in range.
3. Spread: per week = annual ÷ 52, per fortnight = annual ÷ 26, per month = annual ÷ 12.
4. **Regularity:** with at least 3 months in the range, a category with spending in fewer than 60% of months is marked *irregular* (lumpy costs such as registration or insurance).

Example: $960 car registration once a year → $18.46 a week, $36.92 a fortnight, $80.00 a month. These are planning amounts; the real transactions are unchanged.

## Recurring payments and subscriptions

Transactions are grouped by direction and a merchant key (the cleaned first word(s) of the description, e.g. `WOOLWORTHS`, `NETFLIX`). For each group with enough history:

- The **median gap** between payments picks the frequency: weekly 6–8 days, fortnightly 13–15, four-weekly 27–29, monthly 26–35, quarterly 84–98, six-monthly 172–193, annually 350–380.
- At least 3 payments are needed (2 for six-monthly and annual). At least 60% of gaps must fit the frequency (±2 days).
- The **typical amount** is the median; the amount *varies* when the spread exceeds the larger of $1 or 5% of the typical amount.
- A series with no payment for more than 2.5 cycles is treated as stopped and not suggested.
- Confidence is *high* when ≥ 90% of gaps fit, the amount is steady and there are ≥ 4 payments; *medium* at ≥ 75%; otherwise *low*.
- A likely **subscription** is a steady outgoing payment in a subscription category, or a steady monthly/four-weekly/annual payment under $200.

Nothing is treated as recurring until you confirm it. Confirmed items show the next expected date and, if an expected payment was not seen for more than 3 days, *"Not seen on <date>"*.

## Budgets

- **Historical proposal:** each category's average per budget period over the basis range (using the averaging above), rounded **up** to whole dollars. **Manual** budgets are entered directly; **hybrid** starts from the proposal and lets you change any line.
- **Showing a budget for a different period length** (e.g. a monthly budget in a week view): amount × days in the viewed period ÷ days in the budget frequency.
- **Allocated to date** (for an in-progress period) = amount × fraction of the period elapsed.
- **Difference** = allocated − actual, described neutrally: *"Takeaway was $21.80 below the amount allocated."*
- **Sinking funds:** remaining = target − saved; per week / fortnight / month = remaining ÷ number of those periods left before the due date.
- **Bills:** annual equivalent = amount × occurrences per year; spread per month/fortnight/week as above. Marking a bill paid moves it to its next due date; a matching payment within 7 days of the due date can be linked.

## Cash-flow forecast and scenarios

A day-by-day projection from today, for up to 50 years:

- **Starting cash:** the latest known balances of cash accounts (transaction, savings, offset), with the date they are known to.
- **Streams:** confirmed recurring income (as deposited — net of tax), bills, confirmed recurring payments, loan repayments, and **everyday spending** = expense spending over the last six months not already covered by a bill or recurring item, averaged per week. Each stream has its source listed.
- **Growth:** spending grows with the inflation assumption, employment income with the wage-growth assumption, applied on each anniversary of the start date (amount × (1 + rate)^years). Defaults: inflation 3%, wage growth 0%, savings interest 4.2%, investment return 5% — all editable and shown.
- **Savings interest** accrues daily on positive cash that is not sitting in a mortgage offset, and is credited at month end.
- **Mortgage with offset:** when the mortgage has an offset account, the projected cash balance is treated as the offset: interest accrues daily on (loan balance − cash) × rate ÷ 365 and is charged monthly; repayments reduce both cash and the loan.
- **Term deposits** return principal plus interest to cash on maturity.
- **Investments** grow daily at (1 + return)^(1/365) − 1.
- **Outputs:** cash, investments, term deposits, mortgage and net position (cash + investments + term deposits − mortgage; property and other assets are excluded), the lowest cash point and date, and the first dates cash falls below zero or below your low-balance marker.
- **Scenarios** are lists of changes on top of the same assumptions: stop or change income (by stream or type), change spending by a percentage, one-off amounts, new streams, mortgage rate or repayment changes, savings rate changes, and assumption overrides. Starter scenarios (current path, career break, reduced hours, retirement, property purchase, mortgage rate change, major purchase) are editable examples, not suggestions. **Comparisons** list outcomes side by side and never rank them.
- **Snapshots** save a forecast's result so a later forecast can be compared with what was expected.

## Mortgages, loans and debts

- **Interest:** accrues daily on (balance − offset balance, not below zero) × annual rate ÷ 365 and is charged monthly — the common Australian lender method. Repayments are applied on their due dates (weekly, fortnightly or monthly). Extra repayments and dated rate changes are supported.
- **Minimum repayment** for a term: P × i ÷ (1 − (1 + i)^−n), with i = rate ÷ periods per year and n = periods in the term, rounded up to the cent.
- **Offset effect** (headline figure): interest for a year on the loan balance vs on (balance − offset).
- **Comparisons** (with/without offset, with/without extra repayments, different rates) report the difference in total interest and payoff time, neutrally.
- **Several debts:** interest each month = balance × rate ÷ 12; each debt gets its own repayment; any extra amount goes to the first unpaid debt in the order *you* choose (as listed, highest rate first, or smallest balance first), and a cleared debt's repayment rolls to the next. No order is recommended.

## Term deposits

- Interest per period = principal × rate × days ÷ 365 (simple interest on actual days — the usual Australian convention).
- At maturity: one payment. Monthly/quarterly/annual interest can be **paid out** or **added** (compounding); with compounding the next period's interest is on the larger balance.
- The **maturity timeline** lists deposits by maturity date with the total available by each date. Nothing is suggested.

## Savings goals and calculators

- **Compound growth:** the equivalent rate per contribution period for a nominal annual rate compounded *m* times a year, with contributions *k* times a year, is (1 + r/m)^(m/k) − 1. Contributions can be at the start or end of each period and can increase by a percentage each year. Results separate money contributed from estimated growth.
- **Goal projection:** starting from the saved amount, contributions are added on their schedule with interest at the goal's assumed rate until the target is reached (checked up to 100 years).
- **Contribution needed by a target date:** shortfall × i ÷ ((1 + i)^n − 1), where n is the number of scheduled contributions before the date and the shortfall allows for growth on the current balance.
- **Super projection** (calculator): year by year, starting balance + before-tax contributions less contributions tax (15% by default) + after-tax contributions, less fees, plus an assumed net return; contributions can grow each year. Results are in future dollars. Assumptions are always shown; nothing is a recommendation.

## Net worth

For each account, the latest known value on or before the date (imported statement balance, a value you entered, or an estimate such as a property value — each labelled with its source and date). Liabilities are subtracted as positive amounts owed. The history chart uses month-end values and starts from the first month every account has a known value, so a new account's first value does not appear as a jump.

## Tax

See [TAX_RULES.md](TAX_RULES.md).
