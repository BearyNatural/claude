# Changelog — Geranium

Releases are on the [GitHub releases page](https://github.com/BearyNatural/claude/releases) (tags `finance_app-v<version>-build<n>`, marked as pre-releases while Geranium is at 0.x).

## 0.2.0 — 1 October 2026

- **New name: Geranium** (first released as Paperbark). Existing data carries over automatically the first time Geranium opens: the old Paperbark data folder is copied across and its database file renamed. Old `.pbbackup` backups can still be restored; new backups are `.geranium-backup` files. On Windows, uninstall the old Paperbark app separately.
- **Geranium in your browser** at https://daydreaminginthecloud.bearynatural.dev/geranium/ — the same app, with your data encrypted in your browser on that device (nothing is uploaded). Backups move data between the website and the desktop app in either direction.
- **Works on narrow windows and phones**: the menu slides out from a button, and layouts stack.
- **Add an account while importing**, so a first import no longer needs a detour to Accounts.
- **Google Sheets** can be built in (no client set-up) for the desktop app and the website; a privacy page and a desktop download page are published with the website.
- New icon: a geranium flower.
- Fix: the weekly maintenance job could not install Geranium's dependencies.

## 0.1.0 — 27 September 2026

First version.

- **Import** CSV, OFX, QFX, QIF, XLS, XLSX and text-based PDF statements, with a mapping wizard, saved profiles, duplicate detection, statement reconciliation, a review inbox for anything uncertain, and undo. Scanned and password-protected PDFs are detected and explained.
- **Understand** spending with editable rules (learning only with consent), splits, tags, change history, transfer matching, recurring payments and subscriptions, true cost of living, neutral period comparisons, income by source, net worth and plain-English search.
- **Budget** from history, by hand or both; bills, sinking funds and reminders.
- **Plan** with a cash-flow calendar, forecasts and scenarios, snapshots, savings goals, mortgage and offset modelling, debt payoff, term-deposit ladders and calculators.
- **Tax** estimates for 2024–25 to 2027–28 with ATO sources and review dates, payslips, deductions, franking credits, CGT records, study-loan repayments, and GST/BAS preparation summaries.
- **Records** for documents, investments, dividends and super.
- **Export** to Excel (live formulas), CSV and Google Sheets; 17 reports and an accountant package.
- **Privacy and security:** encrypted database and documents, OS keychain or password protection, auto-lock, privacy mode, encrypted backups, network log, no analytics and no bank connections. Hardened Electron build with a packaged self-test.
- Demo household to explore without your own data.
