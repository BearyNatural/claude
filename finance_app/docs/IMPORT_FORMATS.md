# Import formats

Geranium reads statement files you download from your bank, card provider, broker or super fund. It never connects to those institutions. Every import goes through **Import review**: you see each row, what Geranium understood, anything it rejected and why, possible duplicates, and whether the balances reconcile — before anything is saved. Imports can be undone.

## Summary

| Format | Status | Notes |
|---|---|---|
| **CSV / TSV / semicolon-separated** | Works | Columns detected automatically; a mapping screen confirms or corrects them; mappings can be saved as profiles per bank layout |
| **OFX 1.x (SGML) and 2.x (XML)** | Works | Bank, credit-card and multiple-statement files; FITIDs used for duplicate detection; ledger balance used for reconciliation |
| **QFX** (Quicken OFX) | Works | Read as OFX; Intuit-specific tags ignored |
| **QIF** | Works (bank, cash, credit card, other asset/liability) | Files with investment sections are refused with a pointer to the broker import; split lines are shown as hints only |
| **XLSX / XLS** | Works | Each sheet offered separately; then the same mapping as CSV |
| **PDF (text-based)** | Works, with review | Positions of text are used to rebuild the statement table; every row is rated for confidence. Statements that list **several accounts** are split into one statement per account and matched by account number |
| **Payslip PDF** | Works, with review (Income & payslips › Import payslip) | Gross, tax withheld, net, super, salary sacrifice and allowances for this pay (year-to-date columns ignored) fill in the payslip form for checking |
| **Employee share scheme statement PDF** | Works, with review (Tax › Deductions & other records) | The ATO-format statement (NAT 75282): labels D, E, F and C, the income year and employer. The TFN on it is not read |
| **PDF (scanned image)** | Not supported | Detected and explained; no data is invented (no OCR in this version) |
| **Password-protected PDF** | Not supported | Detected; save an unprotected copy or use a CSV/OFX export |
| **Broker trade CSV** | Works (Investments › Import broker CSV) | Buys/sells with quantity, price and brokerage; previewed before saving |

Files larger than 50 MB are refused (export a shorter date range instead).

## CSV and spreadsheets

**Reading.** Text is decoded as UTF-8, falling back to Windows-1252 for older exports; a byte-order mark is ignored. Delimiters (comma, semicolon, tab, pipe) and quoting are handled by PapaParse. Empty lines and footer rows ("Total", "Opening/Closing balance", "End of statement", "Page n") are skipped.

**Detecting columns.** Geranium finds the header row (or recognises that there is none) and assigns each column a role: date, processing/posting date, description (one or more columns joined), amount, debit, credit, CR/DR indicator, balance, reference, account, payee, category, or ignore. Header keywords are matched first; otherwise the content decides (dates, money, text). A **running balance** column is recognised when balance changes match the amounts row by row, in either sort order.

**Amounts.** Three layouts are supported:
- one amount column (the sign convention is detected, or asked about: "positive numbers are money in?"),
- separate debit and credit columns,
- an amount plus a CR/DR (or similar) indicator column.

Money values may include `$`, thousands separators, a leading or trailing minus, parentheses for negatives, or `CR`/`DR` suffixes (`4,102.17CR`).

**Dates.** Supported: `02/08/2026`, `2/8/26`, `02-08-2026`, `2026-08-02`, `02 Aug 2026`, `2-Aug-26`, `Aug 02 2026`, `20260802`, and Excel serial dates in spreadsheets. The format is chosen by scoring every row in the column. When a column fits both day-first and month-first (e.g. every day is 12 or less), Geranium assumes day-first (Australian) and **asks you to confirm**.

**Questions.** When something cannot be decided safely — which column is the amount, the sign convention, an ambiguous date order — the mapping screen asks in plain language instead of guessing. Rows that cannot be read are rejected with a reason (shown on the review screen), never silently dropped or guessed.

**Profiles.** A confirmed mapping can be saved and is matched to future files by the header signature, so the next import from the same bank needs no questions.

## OFX and QFX

Parsed without an XML library so that SGML-style OFX 1.x files with unclosed tags work. Each `STMTRS`/`CCSTMTRS` becomes its own statement, with the account identifier, currency, `STMTTRN` rows (date posted, amount, `FITID`, name/memo, check number, transaction type) and `LEDGERBAL` for the closing balance. Dates with times and time zones (`20260802120000.000[+10:AEST]`) are read as the date printed.

## QIF

`!Type:Bank`, `!Type:Cash`, `!Type:CCard` and `!Type:Oth A`/`Oth L` sections are imported; account lists, category lists, classes and memorised transactions are ignored. Fields: `D` date, `T`/`U` amount, `P` payee, `M` memo, `N` number/reference, `L` category (as a hint). QIF dates have no fixed order (`02/08/2026`, `8/2'26`, `02-08-26`): Geranium looks at every date in the file to decide day-first or month-first and asks when it cannot tell. Split lines (`S`/`$`) are not imported as splits — the transaction is imported whole and the split categories are shown as hints. A file with an investment section (`!Type:Invst`) is refused with a message pointing to **Investments › Import broker CSV**.

## PDF statements

PDF statements have no standard structure. Geranium:

1. Extracts the text layer with PDF.js (nothing is rendered; PDF scripts, XFA forms, fonts and network access are disabled).
2. Rebuilds lines from text positions and finds the column headings (Date, Description/Details, Debit/Withdrawals, Credit/Deposits, Amount, Balance).
3. Reads rows that start with a date; wrapped description lines are joined to the row above; page headers, "continued", totals and brought/carried-forward lines are skipped.
4. Finds the statement period (many wordings: "Statement period 1 Jul 2026 to 31 Jul 2026", "01/07/2026 - 31/07/2026", …) and uses it to give a year to dates printed without one.
5. Finds the opening and closing balances and checks every row's running balance. For **credit cards and loans**, printed balances are amounts owed and are treated that way.
6. Where the statement has no Debit/Credit headings, the change in running balance decides whether a row is money in or out.

Every PDF row gets a confidence rating and reasons. By default all PDF rows go to the review inbox for confirmation (this can be changed under Settings › Import review).

**Statements with several accounts.** Some banks send one statement covering every account, with a section per account ("Account name: …", "Account: 12345678", its own period, headings and opening/closing balance rows). Geranium splits the file at each new account number and reads each section as its own statement. Each section is matched to the account with the same account number (only the last four digits are stored, so a match is used only when exactly one account ends in those digits; the BSB breaks ties). The import screen lists the accounts found with their matches; you can change a match, add a missing account (its name, type and number are filled in from the statement), import everything at once, or review each account on its own. Each section is checked exactly as a single statement would be.

These statements also showed some layouts that are now read correctly everywhere: shaded rows printed twice in the same place (read once), rows whose amount wraps onto the next line (joined into one transaction), "REF:" lines on their own dated line (added to the transaction above), dates split over two lines ("20" / "May"), mailing codes printed in the margin over a row (ignored), and notes with a number in the description area such as "INT SAVED BY BALANCE OFFSET 123.45" or "RATE CHANGED" (not transactions).

**Super fund statements** work the same way. Amounts split across columns such as *Employer SG*, *Employer additional*, *Member before-tax* and *Member after-tax* are read from the *Total* column, and the column an amount sits in decides its Superannuation category. "Opening/Closing account balance" rows are used as the statement's balances. Period totals printed without a date (fees, tax benefits, contributions tax) are dated with the row above and flagged for a quick check. Import super statements into an account of type *Superannuation* so they stay separate from household money and personal tax.

**Known PDF limitations:** layouts very different from a date-led table (for example summaries with amounts in sentences, or several transactions per line) may produce few or no rows — Geranium says so rather than guessing; scanned statements are not read; foreign-currency details (original amount, conversion fees on separate lines) are not recognised as such and need checking in review; statements where the printed balance column is missing cannot be verified row by row (reconciliation then relies on opening/closing totals only).

## Payslips and employee share scheme statements

**Payslips** (Income & payslips › *Import payslip (PDF)*): payslips are laid out differently by every employer, so Geranium looks for the usual labels — *Gross pay*, *PAYG tax*, *Net pay*, *Superannuation*, *Salary sacrifice*, allowances, *Pay date*, *Pay period* and the employer — and takes the amount for this pay, ignoring any *YTD* / *Year to date* column. Summary rows laid out as columns ("Gross Pay | Tax | Net Pay" with the amounts underneath) are read too. After-tax deductions are worked out as gross − salary sacrifice − tax − net. The figures fill in the payslip form, which says what was found and what wasn't; nothing is saved until you check and save it. A copy of the payslip can be kept (encrypted) with it.

**Employee share scheme statements** (Tax › Deductions & other records › *Import share scheme statement*): the year-end statement in the ATO format (NAT 75282). Geranium reads label D (taxed-upfront discount, eligible for the reduction), E (taxed-upfront, not eligible), F (discount from deferral schemes), C (TFN amounts withheld from discounts), the income year and the employer's name and ABN. The employee's TFN printed on the statement is deliberately not read or stored. The amounts are shown for checking and saved as tax records for the chosen year; saving the same employer's statement for the same year again replaces the earlier amounts. The statement does not say how many shares were received, so add the shares themselves on the Investments screen (their cost base is their market value when they were taxed).

Scanned (image-only) PDFs can't be read for either; enter the figures by hand.

## Checks on every import

- **Duplicates.** A matching institution ID (OFX `FITID`) is conclusive. Otherwise date, description, amount, running balance and reference are scored together — the same amount alone is never enough. Each existing transaction can "use up" only one incoming row, so two genuine identical purchases on the same day are both kept. Uncertain matches go to the review inbox. Re-importing the exact same file is recognised by its hash.
- **Reconciliation.** Opening balance + transactions is compared with the closing balance. If they differ, the result lists likely causes (a missing or misread row, a duplicate, a sign error) and the difference. Statements without balances are marked "not verifiable" rather than "reconciled".
- **Coverage.** Each import records the period it covers, so analysis can warn about gaps ("no card statements after 31 July") instead of treating missing months as zero spending.
- **Review inbox.** Rows are held for review (not counted anywhere) when they are low-confidence, possible duplicates, possible transfers between your own accounts, uncertain categories, or read from a PDF — each with a stated reason. Which of these are held is configurable.
- **Originals kept.** The original description is never changed; the source file can optionally be kept (encrypted) with the import.

## Tips

- Prefer CSV or OFX exports where your bank offers them; they are exact.
- Download overlapping date ranges freely — duplicates are recognised.
- Import every account (including credit cards and the offset account), so transfers between them can be matched and not counted as spending or income.
