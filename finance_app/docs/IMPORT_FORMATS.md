# Import formats

Paperbark reads statement files you download from your bank, card provider, broker or super fund. It never connects to those institutions. Every import goes through **Import review**: you see each row, what Paperbark understood, anything it rejected and why, possible duplicates, and whether the balances reconcile — before anything is saved. Imports can be undone.

## Summary

| Format | Status | Notes |
|---|---|---|
| **CSV / TSV / semicolon-separated** | Works | Columns detected automatically; a mapping screen confirms or corrects them; mappings can be saved as profiles per bank layout |
| **OFX 1.x (SGML) and 2.x (XML)** | Works | Bank, credit-card and multiple-statement files; FITIDs used for duplicate detection; ledger balance used for reconciliation |
| **QFX** (Quicken OFX) | Works | Read as OFX; Intuit-specific tags ignored |
| **QIF** | Works (bank, cash, credit card, other asset/liability) | Files with investment sections are refused with a pointer to the broker import; split lines are shown as hints only |
| **XLSX / XLS** | Works | Each sheet offered separately; then the same mapping as CSV |
| **PDF (text-based)** | Works, with review | Positions of text are used to rebuild the statement table; every row is rated for confidence |
| **PDF (scanned image)** | Not supported | Detected and explained; no data is invented (no OCR in this version) |
| **Password-protected PDF** | Not supported | Detected; save an unprotected copy or use a CSV/OFX export |
| **Broker trade CSV** | Works (Investments › Import broker CSV) | Buys/sells with quantity, price and brokerage; previewed before saving |

Files larger than 50 MB are refused (export a shorter date range instead).

## CSV and spreadsheets

**Reading.** Text is decoded as UTF-8, falling back to Windows-1252 for older exports; a byte-order mark is ignored. Delimiters (comma, semicolon, tab, pipe) and quoting are handled by PapaParse. Empty lines and footer rows ("Total", "Opening/Closing balance", "End of statement", "Page n") are skipped.

**Detecting columns.** Paperbark finds the header row (or recognises that there is none) and assigns each column a role: date, processing/posting date, description (one or more columns joined), amount, debit, credit, CR/DR indicator, balance, reference, account, payee, category, or ignore. Header keywords are matched first; otherwise the content decides (dates, money, text). A **running balance** column is recognised when balance changes match the amounts row by row, in either sort order.

**Amounts.** Three layouts are supported:
- one amount column (the sign convention is detected, or asked about: "positive numbers are money in?"),
- separate debit and credit columns,
- an amount plus a CR/DR (or similar) indicator column.

Money values may include `$`, thousands separators, a leading or trailing minus, parentheses for negatives, or `CR`/`DR` suffixes (`4,102.17CR`).

**Dates.** Supported: `02/08/2026`, `2/8/26`, `02-08-2026`, `2026-08-02`, `02 Aug 2026`, `2-Aug-26`, `Aug 02 2026`, `20260802`, and Excel serial dates in spreadsheets. The format is chosen by scoring every row in the column. When a column fits both day-first and month-first (e.g. every day is 12 or less), Paperbark assumes day-first (Australian) and **asks you to confirm**.

**Questions.** When something cannot be decided safely — which column is the amount, the sign convention, an ambiguous date order — the mapping screen asks in plain language instead of guessing. Rows that cannot be read are rejected with a reason (shown on the review screen), never silently dropped or guessed.

**Profiles.** A confirmed mapping can be saved and is matched to future files by the header signature, so the next import from the same bank needs no questions.

## OFX and QFX

Parsed without an XML library so that SGML-style OFX 1.x files with unclosed tags work. Each `STMTRS`/`CCSTMTRS` becomes its own statement, with the account identifier, currency, `STMTTRN` rows (date posted, amount, `FITID`, name/memo, check number, transaction type) and `LEDGERBAL` for the closing balance. Dates with times and time zones (`20260802120000.000[+10:AEST]`) are read as the date printed.

## QIF

`!Type:Bank`, `!Type:Cash`, `!Type:CCard` and `!Type:Oth A`/`Oth L` sections are imported; account lists, category lists, classes and memorised transactions are ignored. Fields: `D` date, `T`/`U` amount, `P` payee, `M` memo, `N` number/reference, `L` category (as a hint). QIF dates have no fixed order (`02/08/2026`, `8/2'26`, `02-08-26`): Paperbark looks at every date in the file to decide day-first or month-first and asks when it cannot tell. Split lines (`S`/`$`) are not imported as splits — the transaction is imported whole and the split categories are shown as hints. A file with an investment section (`!Type:Invst`) is refused with a message pointing to **Investments › Import broker CSV**.

## PDF statements

PDF statements have no standard structure. Paperbark:

1. Extracts the text layer with PDF.js (nothing is rendered; PDF scripts, XFA forms, fonts and network access are disabled).
2. Rebuilds lines from text positions and finds the column headings (Date, Description/Details, Debit/Withdrawals, Credit/Deposits, Amount, Balance).
3. Reads rows that start with a date; wrapped description lines are joined to the row above; page headers, "continued", totals and brought/carried-forward lines are skipped.
4. Finds the statement period (many wordings: "Statement period 1 Jul 2026 to 31 Jul 2026", "01/07/2026 - 31/07/2026", …) and uses it to give a year to dates printed without one.
5. Finds the opening and closing balances and checks every row's running balance. For **credit cards and loans**, printed balances are amounts owed and are treated that way.
6. Where the statement has no Debit/Credit headings, the change in running balance decides whether a row is money in or out.

Every PDF row gets a confidence rating and reasons. By default all PDF rows go to the review inbox for confirmation (this can be changed under Settings › Import review).

**Known PDF limitations:** layouts very different from a date-led table (for example summaries with amounts in sentences, or several transactions per line) may produce few or no rows — Paperbark says so rather than guessing; scanned statements are not read; foreign-currency details (original amount, conversion fees on separate lines) are not recognised as such and need checking in review; statements where the printed balance column is missing cannot be verified row by row (reconciliation then relies on opening/closing totals only).

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
