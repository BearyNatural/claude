# Geranium — end-of-project report

Version 0.2.0 · 1 October 2026 · project folder `finance_app/` in [BearyNatural/claude](https://github.com/BearyNatural/claude)

*Geranium was first released (0.1.0) as Paperbark and renamed in 0.2.0, which also added the browser version at [daydreaminginthecloud.bearynatural.dev/geranium](https://daydreaminginthecloud.bearynatural.dev/geranium/).*

## What was built

A desktop-first, local-first personal finance, budgeting and planning application for Australian households, for Windows, macOS and Linux, plus a browser version built from the same code (data encrypted in the browser, nothing uploaded). It helps people **see where their money went, understand where it is going, and model where it could go next** — without connecting to banks and without making decisions for them.

The pieces work together as one picture. For the demo household (fortnightly salary with PAYG withheld, occasional contracting income with no tax withheld, weekly groceries, quarterly electricity, annual registration and insurance, a mortgage with an offset account, regular savings transfers, term deposits maturing, monthly interest, dividends with franking, a credit card whose statements stop in July):

- imports reconcile each statement and flag the card account's missing months;
- analysis separates transfers from spending, spreads annual and quarterly bills into a **true cost of living**, and detects the recurring salary, bills and subscriptions (with a note when an expected subscription payment was not seen);
- budgets compare allocations with actual spending in neutral language;
- the cash-flow calendar and forecast combine confirmed pay, bills, loan repayments, everyday spending, term-deposit maturities and the mortgage offset into a day-by-day projection with scenarios;
- the tax estimate combines payslips (gross, PAYG), contractor income without withholding, interest, dividends and franking credits, deductions and capital gains — with a warning while the year is still in progress;
- net worth combines dated account balances, estimated property and vehicle values, investments and super.

**Size:** 26 screens; ~150 validated API methods; domain engines for import (6 formats), categorisation, recurring detection, analysis, budgets, forecasting and scenarios, loans and offsets, debts, term deposits, goals, compound growth, Australian tax (4 financial years), CGT, GST/BAS, payslips, investments, super, net worth, search and spreadsheet output; 175 automated tests.

**Screens:** Dashboard (configurable sections, data freshness), Cash-flow calendar, Net worth, Accounts, Transactions (search, filters, bulk edit, splits, tags, history), Import (wizard, mapping, review, reconciliation, history, undo), Review inbox, Categories & rules (rules, learning suggestions, transfers), Recurring & subscriptions, Spending & cost of living (where it went, true cost of living, comparisons, category drill-down), Budgets, Bills & sinking funds, Savings goals, Forecast & scenarios (assumptions, scenarios, snapshots), Mortgage & debts, Term deposits, Calculators (compound growth, loan repayments, super projection), Income & payslips, Tax estimate & GST (estimate, deductions and records, GST & BAS, rules & sources), Investments (holdings, trades, dividends, capital gains, broker CSV import), Super, Reports & export (reports, Excel, Google Sheets, CSV, accountant package), Documents, Settings & privacy (preferences, privacy & security, reminders, import review), Backup & restore; plus set-up, unlock, onboarding and demo mode.

## Architecture

Electron 44 app in three strictly separated layers (details in [ARCHITECTURE.md](ARCHITECTURE.md), reasons in [DECISIONS.md](DECISIONS.md)):

- **Domain** (`src/domain`, pure TypeScript): all calculations, parsers and rules. Money in integer cents, ISO dates with UTC arithmetic, "today" always passed in. No I/O, fully unit-tested.
- **Main process** (`src/main`): encrypted storage (sql.js SQLite in memory, AES-256-GCM on disk), key management, services that fetch data and call the domain, a single validated IPC API (~150 methods with zod schemas), Google OAuth/Sheets, backups, reminders.
- **Renderer** (`src/renderer`): React 19 UI in a sandboxed, context-isolated window served from `app://geranium` with a strict CSP and no network access. Dependency-free SVG charts with legends, tooltips and table views.

Tauri was considered; Electron was chosen because the parsing work depends on mature JavaScript libraries (PDF.js, SheetJS, sql.js) that should run outside the webview, and a single language keeps the domain, UI and tests aligned.

## Security/privacy model

Full detail: [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).

- **Local storage:** one per-user data folder (`…/Geranium/vault`); no server, no account, no analytics, no bank connections. Owner-only file permissions.
- **Encryption:** a random 256-bit data key encrypts the SQLite database (whole-file AES-256-GCM, authenticated header, atomic writes with a `.prev` copy) and every stored document. The data key is wrapped either by the OS credential store (Keychain / DPAPI / Secret Service, via Electron `safeStorage`) or by a password/PIN through scrypt (N = 2¹⁷). No recovery without the password — by design.
- **Application lock:** manual lock (Ctrl+L), auto-lock on idle, sleep, screen lock or minimise, maximum session length; unlock throttling after 5 failures; the key is wiped from memory on lock (best effort). With OS protection the lock hides data but does not stop someone signed in as the user — the app explains this and recommends a password. Privacy mode masks every amount.
- **Backup:** one `.geranium-backup` file encrypted with its own password (scrypt + AES-256-GCM), saved wherever the user chooses; restore checks the password and contents, keeps an encrypted copy of current data and migrates older schemas.
- **Network:** renderer has none; the main process can only reach three Google API hosts over HTTPS, and only for a user-initiated Sheets export; every request is listed in an in-app network log.
- **Hardening:** sandboxed renderer, context isolation, CSP, blocked navigation/new windows/permissions, sender checks on IPC, error sanitising, Electron fuses (no run-as-node, no `NODE_OPTIONS`, no inspector, asar integrity, load only from asar), CSV formula-injection protection.

## Import support

Full detail: [IMPORT_FORMATS.md](IMPORT_FORMATS.md).

| Works | Limitations |
|---|---|
| **CSV/TSV** (auto-detected columns, 3 amount layouts, 6 date formats plus Excel serial dates, profiles) | Asks when the date order or sign convention is ambiguous; unreadable rows are rejected with a reason |
| **OFX 1.x/2.x, QFX** | Investment statements inside OFX are not imported |
| **QIF** (bank, cash, card, other asset/liability) | Split lines become hints only; investment QIF refused |
| **XLSX/XLS** | Formulas read as cached values; each sheet chosen separately |
| **Text-based PDF statements** (period, balances, running-balance checks, card statements as liabilities) | Layout-dependent; unusual layouts may produce few rows; every PDF row goes to review by default |
| **Broker trade CSV** | Buys and sells only |
| Not supported | **Scanned PDFs (no OCR)**, password-protected PDFs, direct bank feeds (by design) |

Every import shows a review screen with duplicates (FITID or scored evidence — never amount alone), statement reconciliation, rejected rows and coverage; uncertain rows wait in the Review inbox; imports can be undone.

## Budgeting engine

Details and formulas: [CALCULATIONS.md](CALCULATIONS.md).

- **Averages:** total ÷ days actually covered by imported data, scaled to day/week/fortnight/month/quarter/year (52/26/12 and 365.25-day conventions); the explanation panel shows the transaction count and dates.
- **True cost of living:** one-offs excluded, annualised, spread to week/fortnight/month; categories spent in fewer than 60% of months are marked irregular.
- **Budgets:** historical (average per period, rounded up to whole dollars), manual or hybrid; scaled to other period lengths by days; "allocated to date" for in-progress periods; differences described neutrally.
- **Sinking funds:** remaining ÷ periods left before the due date. **Bills:** annual equivalent and per-period spread; mark paid; match a payment within 7 days.
- **Recurring detection:** median gap mapped to frequency bands, ≥ 60% regular gaps, median amount, stopped series ignored; nothing is recurring until confirmed.

## Forecast engine

A day-by-day cash projection for up to 50 years. **Assumptions** (all visible and editable, each with its source): starting cash from the latest dated balances of cash accounts; confirmed recurring income as deposited (net); bills and confirmed recurring payments; loan repayments; everyday spending averaged from the last six months (excluding anything already listed, transfers and one-offs); inflation 3% on spending and 0% wage growth by default, applied on anniversaries; savings interest (4.2% default) accrued daily on cash not in an offset and credited monthly; investment return (5% default) compounded daily; term deposits returning principal and interest at maturity; the mortgage modelled with the cash balance as the offset. Outputs: cash, investments, term deposits, mortgage and net position, the lowest cash point, and the first dates below zero or a low-balance marker. **Scenarios** layer changes (income stop/change, spending change, one-offs, new streams, mortgage rate/repayment, savings rate, assumption overrides) over the same assumptions; comparisons never rank scenarios; snapshots let a later forecast be compared with an earlier expectation. Historical records are never changed.

## Mortgage/debt engine

- Interest accrues daily on (balance − offset, not below zero) × rate ÷ 365 and is charged monthly; repayments (weekly/fortnightly/monthly) apply on their dates; extra repayments, dated rate changes and changing offset balances are supported.
- Minimum repayment P·i ÷ (1 − (1+i)^−n); the one-year "offset effect"; neutral comparisons of total interest and payoff time.
- Multiple debts: monthly interest = balance × rate ÷ 12; extra money goes to the first unpaid debt in the order the user chooses (as listed, highest rate first, smallest balance first) and payments roll over when a debt is cleared. No order is recommended.
- Term deposits: simple interest on actual days ÷ 365, paid out or compounding; a maturity timeline.

## Australian tax engine

Full detail: [TAX_RULES.md](TAX_RULES.md).

- **Financial years supported:** 2024–25, 2025–26 and 2026–27 (published ATO figures, with 2026–27 Medicare thresholds provisional), 2027–28 (legislated 14% rate, other figures provisional). Later years fall back to the latest rules, marked provisional. Rules were reviewed on 27 September 2026.
- **Components:** resident income tax rates; LITO; Medicare levy with the low-income reduction (and exemption); study and training loan repayments (percentage system for 2024–25, marginal system from 2025–26, including reportable super in repayment income); franking credits as a refundable offset; PAYG withheld and PAYG instalments; payslips (gross, allowances, salary sacrifice, super); deductions and business-use percentages; contractor/sole-trader income (a business loss is not netted against other income); CGT records with FIFO parcels, brokerage in cost base and proceeds, the 12-month rule and 50% discount, and "unavailable" when a cost base is missing; GST classification and Simpler BAS G1/1A/1B preparation; super contribution caps.
- **Authoritative sources:** ATO pages for resident rates, the new tax cuts, Medicare levy reduction (two pages), LITO, study-loan thresholds, super contribution caps, super guarantee, GST registration, Simpler BAS and the CGT discount — all linked in the app and in `sources.ts` with the date read.
- **Known omissions:** Medicare levy surcharge and private health insurance rebate; other offsets (SAPTO etc.); family-income Medicare reductions; carried-forward capital losses; non-resident, part-year and working-holiday rates; reportable fringe benefits; non-commercial loss rules; Division 293; foreign income; employee share schemes; lump sums/ETPs; trusts and partnerships; the small business income tax offset. Every estimate is labelled as not an ATO assessment or tax advice.

## Business/GST support

Works: marking income as contractor/sole-trader/business, business expenses and business-use percentages for mixed expenses, net business income in the tax estimate, GST classes per transaction, GST at 1/11 or from invoices, quarterly Simpler BAS preparation figures on a cash basis, a GST turnover note against the $75,000 threshold, and an accountant package export.

Limitations: no invoicing, accounts receivable/payable, payroll or PAYG withholding for employees, fuel tax credits, full BAS labels beyond G1/1A/1B, accrual-basis GST, depreciation schedules or the instant asset write-off, and no lodgment. Summaries are labelled "Preparation summary only — verify before lodgment."

## Investment/super support

Works: securities, buy/sell trades with brokerage, broker CSV import with preview, prices entered by the user with dates, holdings value and unrealised difference, dividends with franked/unfranked amounts and franking credits from statements, investment income by financial year, CGT events and estimates; super statement balances, contributions by type, fees, insurance, earnings, comparison with contribution caps, balance history, and a projection calculator.

Does not work (yet): automatic price feeds (deliberately — no network); corporate actions such as splits, consolidations, DRP parcels and returns of capital (record them as trades); foreign shares and currencies; managed funds' tax statements (AMIT components); carry-forward concessional cap and bring-forward calculations; retirement income streams; fund comparisons (Geranium never recommends funds or investments).

## Spreadsheet support

- **XLSX:** one workbook model rendered by Geranium's own OOXML writer: transactions, spending by category (`SUMIFS` over the transaction sheet), budget vs actual (difference formulas), bills, goals, loans (with a `PMT` check), term deposits (interest formulas), holdings, tax estimate (`SUMPRODUCT` over the bracket table), forecast, scenarios, and an About sheet with assumptions and disclaimers. Currency, date and percent formats, frozen headers, full recalculation on open. Verified by reading back with SheetJS and by **recalculating in LibreOffice headless** in the test suite.
- **CSV:** transactions and every report; UTF-8 with BOM for Excel; cells that could be read as formulas are neutralised.
- **Google Sheets:** optional; user's own OAuth client, loopback + PKCE sign-in, `drive.file` scope only. **Snapshot** (a new spreadsheet each time) or **managed** (updates the same spreadsheet); the same formulas and formats as the XLSX export. The request plan is unit-tested; it has **not** been exercised against a live Google account in this build (see limitations).
- **Reports:** 17 reports (cash flow, cost of living, spending by category, recurring, subscriptions, income by source, savings rate, business summary, GST summary, tax estimate, mortgage progress, debt, investment income, interest income, term deposits, net worth, annual expenditure), each viewable, exportable to CSV/XLSX, and an accountant package (README, income, business, tax categories, GST, dividends, interest, transactions, documents index).

## Tests

**185 automated tests in 14 files — all passing** (vitest 3.2.7, Node 22, 1 October 2026):

| File | Tests | Covers |
|---|---:|---|
| `tests/domain/foundations.test.ts` | 18 | money parsing/rounding/allocation, dates and financial years, periods, frequency conversion, schedules |
| `tests/domain/import.test.ts` | 29 | CSV detection and mapping, date formats, amounts, running balances, OFX/QFX, QIF, spreadsheets, duplicates, reconciliation |
| `tests/domain/understanding.test.ts` | 28 | description cleaning, rules, regex safety, learning suggestions, transfers, recurring detection, analysis, cost of living, comparisons, budgets, bills |
| `tests/domain/planning.test.ts` | 20 | compound growth, goals, loans and offsets, debts, term deposits and ladders, forecasts, scenarios |
| `tests/domain/tax.test.ts` | 21 | year rules and sources, rates, LITO, Medicare phase-in and study loans against ATO examples, estimates, CGT, GST/BAS, payslips |
| `tests/domain/records.test.ts` | 13 | investments (FIFO holdings, franking only from statements), super caps and projection, calculated balances, net worth and history, search parsing, CSV formula-injection protection, XLSX output |
| `tests/main/storage.test.ts` | 8 | encryption and tamper detection, no plaintext on disk, fallback to the previous copy, migrations and newer-version refusal, key store (OS store, weak Linux store, password set/change/remove, no-OS-store case) |
| `tests/main/pdfImport.test.ts` | 7 | generated PDF statements: periods, balances, reconciliation, misread rows, card statements, scanned PDFs, non-PDFs |
| `tests/main/importService.test.ts` | 9 | end-to-end imports: categorising and staging, saved profiles and duplicate skipping, PDF reconciliation, corrections before import with history, mapping questions, undo, learning only with consent, splits, transfer linking |
| `tests/main/xlsxLibreOffice.test.ts` | 1 | the generated XLSX recalculated in LibreOffice (runs when `soffice` is installed; it ran here) |
| `tests/main/selfTest.test.ts` | 2 | the packaged-app self-test and its sample PDF |
| `tests/web/shims.test.ts` | 8 | the browser build's crypto (byte-identical AES-GCM, tags and scrypt keys compared with Node; tamper, wrong key and short-tag rejection), file system and paths |
| `tests/web/browserStorage.test.ts` | 1 | the real storage code on the browser shims: set-up (password required), encrypted save, lock, wrong password, unlock, backup and reopen |
| `tests/main/demoIntegration.test.ts` | 19 | the whole demo household through every service: reconciliation, inbox, missing-data warnings, dashboard, spending, cost of living, recurring, net worth, budgets, goals, loans, forecasts and scenarios, tax, BAS, investments, super, workbook, CSV and all 17 reports, reminders, encrypted backup and restore (wrong password vs damaged file), search |

Other checks run on this build:

- `tsc --noEmit` (strict): no errors.
- **Semgrep** (`p/javascript`, `p/typescript`, `p/react`, `--error`): 0 findings (one finding — GCM decipher without an explicit tag length — was fixed, not suppressed).
- **gitleaks**: no secrets.
- **npm audit** (production, high): 0 vulnerabilities.
- **OSV-Scanner**: no unaddressed findings; 3 documented, time-limited exceptions (two false positives for the fixed SheetJS 0.20.3 CDN build; one dev-only vitest advisory — see [DECISIONS.md](DECISIONS.md) §12).
- **Licences** (production dependencies): MIT ×11, Apache-2.0 ×2, BSD-3-Clause ×1 — all on the allow-list.
- **Packaged Linux build:** `geranium --self-test` passed inside the asar package (encrypted database, finance engines with demo data, PDF.js, XLSX write/read); Electron fuses verified; `ELECTRON_RUN_AS_NODE` confirmed ignored. AppImage and .deb built successfully.
- **Visual review:** every screen captured with the demo household (light theme, plus the dashboard in dark) and reviewed; issues found were fixed (empty-week dashboard, unfair partial-period comparisons, net-worth history jumps, duplicate chart labels, truncated labels, overflowing inbox table, reference numbers in payee names, missed recurring payments, report month labels, backup screen in demo mode).
- Windows and macOS installers are built and self-tested by CI (`finance_app-desktop.yml`) on their own runners.
- **Browser version, checked in a real browser:** set-up with a password (only ciphertext and the wrapped key reach IndexedDB), reload and unlock, CSV import with a new account created during import, PDF statement reading inside the worker, encrypted backup and restore (with the safety copy), narrow-screen layout and menu.

## Known limitations

- **No OCR:** scanned PDF statements are detected but not read.
- **PDF layouts vary:** statements that are not date-led tables may yield few rows (reported, never guessed).
- **Unsigned installers:** Windows SmartScreen and macOS Gatekeeper warnings; no notarisation; no auto-update.
- **Linux AppImage** may need `--no-sandbox` on distributions that restrict user namespaces (the .deb does not).
- **Google Sheets** uses a built-in client once the Geranium Google Cloud project's IDs are added (otherwise the desktop app asks for one); it has not yet been tested against a live Google account.
- **Browser version:** always needs a password (no OS keychain); no background reminders; data lives in browser storage that clearing site data — or Safari after 7 days without a visit, unless added to the Home Screen — removes; one tab at a time; Google access lasts about an hour per connection; the file picker and downloads follow each browser's rules.
- **AUD only;** single user per data folder; no sync between devices (backups only).
- **Reminders** are desktop notifications while Geranium is running; there is no background service.
- **Memory:** the decrypted database is held in memory while unlocked; very large histories (hundreds of thousands of transactions) have not been benchmarked. The demo (1,299 transactions, 1.6 MB database) seeds in under a second.
- **Tax:** resident individuals only, with the omissions listed above; 2026–27 Medicare thresholds and all 2027–28 figures other than the 14% rate are provisional.
- **Investments/super:** no price feeds, no corporate actions, no foreign securities, no AMIT statements, no carry-forward/bring-forward cap calculations.
- **Business:** no invoicing/payroll/depreciation/lodgment; Simpler BAS labels only; cash basis only.
- **Accessibility** follows WCAG practices (labels, focus management, keyboard use, contrast, table views) but has not been audited with screen readers.
- **Language:** English (Australia) only.
- **Licence:** the project is marked `UNLICENSED` (all rights reserved), consistent with the rest of the repository, which has no licence file. Choose a licence before inviting outside use or contributions.

## Security work still needed before public release

1. Code signing (Windows certificate, Apple Developer ID), hardened runtime and notarisation on macOS, then a signed auto-update channel. For the website: Subresource Integrity and published checksums for each web release.
2. An independent review of the crypto, key-handling, backup and IPC code, and fuzzing of all file parsers with malformed input.
3. A decision on memory-resident data: consider SQLCipher/native storage if the threat model includes malware on an unlocked machine.
4. An AppArmor profile or documented install path for the Linux AppImage sandbox.
5. Upgrade vitest (dev-only advisory) when CI's npm supports it; keep the OSV exceptions under review (they expire).
6. A privacy policy, a support contact and a vulnerability-reporting process (SECURITY.md) for public users.
7. Google OAuth app verification if a shared client is ever offered instead of user-supplied clients.

## Recommended next development work

1. **Real-world import coverage:** collect anonymised layouts from the big four banks, Macquarie, ING, Up, Bendigo and the major card issuers; add profiles and PDF layout tests for each.
2. **OCR (optional, local):** a local OCR engine for scanned statements, feeding the existing "OCR — please check" review path.
3. **Signed releases and auto-update** (after code signing).
4. **Tax:** Medicare levy surcharge and private health insurance rebate, SAPTO, carried-forward capital losses, and a yearly rules-review checklist that fails CI when `lastReviewed` is more than a year old.
5. **Investments:** corporate actions (splits, DRP, return of capital), AMIT statements, CSV price import.
6. **Super:** carry-forward concessional cap tracking with total super balance.
7. **Sync without a server:** optional encrypted sync via a user-chosen folder (e.g. the same encrypted database format in a cloud-synced directory with conflict detection).
8. **Accessibility audit** with NVDA, VoiceOver and Orca, and a large-text layout review.
9. **Performance:** benchmark and index for 100k+ transactions; consider incremental saves.
10. **Localisation groundwork** (currency and date formats) if the audience grows beyond Australia.
