# Changelog — Geranium

Releases are on the [GitHub releases page](https://github.com/BearyNatural/claude/releases) (tags `finance_app-v<version>-build<n>`, marked as pre-releases while Geranium is at 0.x).

## 0.7.0 — 12 October 2026

- **Businesses that share a first word are told apart.** Categorising used to group transactions by their first word, so a company's pay deposits and purchases from a different business with the same first word looked like the same payee. Now:
  - Earlier choices for the same name (for example "BIGRIVER H G") come before ones that only share the first word.
  - Money in and money out are kept apart, so pay never teaches a category for purchases.
  - A match on the first word alone goes to the Review inbox for you to check.
  - Learned rules use the shared part of the name ("BIGRIVER H G", "CORNER BUTCHER") and apply only to money in or only to money out.
  - Rules learned before this release now apply only in their category's direction, and purchases they caught by mistake are re-categorised (never ones you categorised yourself).
  - New built-in rules: Amazon Web Services → Software, Amazon Prime → Streaming.
  - Bank wording such as "ePayment From:", "Auto Payment From:" and "PAYW" is ignored when reading the name.
- **Tax-deductible expense categories.** A new *Tax-deductible expenses* group, following the tax return's labels:
  - The categories: work car (D1); work travel (D2); work clothing, uniforms and laundry (D3); self-education (D4); working from home, phone and internet work share, stationery and office supplies, tools and equipment, union and professional memberships, work subscriptions, and other work-related expenses (D5); donations to registered charities (D9); and tax agent and managing tax affairs (D10).
  - Spending in them counts towards the tax estimate's deductions automatically.
  - On a transaction, the Tax setting "Automatic (from its category)" shows when it counts; set "Not tax-related" to leave one out.
  - Split a partly private bill to claim only the work share.
  - The tax-agent package now includes `deductions.csv` with each item's label.

## 0.6.0 — 11 October 2026

- **Geranium learns from your own documents, on your own device.** Two parts, both on by default, each with its own switch in Settings › Imports & learning (renamed from "Import review"):
  - **Learned layouts.** When you save a payslip read from a PDF, or import a PDF statement that balances, Geranium remembers where each figure was printed. The next document with the same layout is read the same way, so a correction made once is remembered.
  - **Machine learning trained on your documents.** A small model (logistic regression) learns from every document you confirm which numbers and dates are gross pay, tax, super, net pay, dates and balances. After 5 confirmed documents it helps with layouts Geranium hasn't learned yet. It never uses anyone else's data and isn't an AI service.
  - Figures on the payslip form say when they came from a learned layout or the model. Settings lists every learned layout (delete any of them), what the model has learned, and a button to make it forget.
- **Fix:** reviewing a loan or credit-card section of a statement on its own showed its balances with the wrong sign, so the check reported a difference. The review screen now uses the balances for the account you choose, unless you type your own.

## 0.5.1 — 11 October 2026

- **Linux: the panel and menu icon now really shows.** The package only installed a 1024×1024 icon, a size desktop icon themes don't look in, so Cinnamon and others found no icon at all. It now installs the standard sizes (16 to 512 pixels).
- **Payslip import is much more accurate:**
  - Year-to-date figures are recognised in more layouts: a "Year To Date | This Period" summary side by side, a separate year-to-date table further down the page, and a "Year to Date Totals" section. Only this pay's figures are read, and a year-to-date table no longer hides the summary above it.
  - Labels are read wherever they sit on a line, not only at the start.
  - A super contributions table ("Nett | Tax | Gross") is read as employer super, not as gross pay and tax.
  - Employer super is recognised in more wordings, such as "EmpER SGC" or a fund name next to its amount.
  - Pay dates and periods are read from column headings, "Banked:" dates and dates like "08-JUN-2026".
  - Section headings like "Employer message" or "Company Superannuation Contributions" are no longer taken for the employer's name.
- When a payslip doesn't print the employer's name (only the ABN), the name you type is remembered for that ABN and filled in on that employer's next payslip.

## 0.5.0 — 10 October 2026

- **Statements with several accounts.** A PDF statement that covers several accounts (as some banks send them) is split into one statement per account. Each is matched to your account with the same account number; the import screen lists them with their matches, lets you change a match or add a missing account (name, type and account number filled in from the statement), and imports them all at once or one at a time — each reconciled on its own.
- **More bank layouts read correctly:** shaded rows printed twice, amounts that wrap onto the line below, "REF:" lines, dates split over two lines, mailing codes in the margin, and notes such as "INT SAVED BY BALANCE OFFSET" or "RATE CHANGED" are no longer misread.
- **Import a payslip (PDF)** on Income & payslips: gross pay, tax withheld, net pay, super, salary sacrifice, allowances, pay date, period and employer fill in the payslip form for you to check (year-to-date columns are ignored). A copy of the payslip can be kept.
- **Employee share schemes.** Import the ATO-format employee share scheme statement on Tax › Deductions & other records (labels D, E, F and C). The discounts go into the tax estimate, with the up-to-$1,000 reduction for label D when income is $180,000 or less, and TFN amounts withheld count as tax already paid. The TFN on the statement is not read.
- **A background picture:** geraniums in a soft field behind the content (cards stay solid so figures are always clear), drawn for light and dark themes. Choose *Geraniums in a field*, *A quiet field* or *Plain* in Settings › Appearance; it is hidden in high contrast and when printing.
- **Linux: the icon now shows in the panel/taskbar and app switcher.** The window now carries the Geranium icon, and its window class matches the installed desktop entry.
- The content area now scrolls on its own: the top bar and sidebar stay in place, and each screen opens at the top.

## 0.4.0 — 10 October 2026

- **Superannuation kept separate.** New *Superannuation* categories: employer contributions (Super Guarantee), employer additional & salary sacrifice, personal contributions before and after tax, government contributions, investment returns, fees, insurance, tax in the fund, rollovers and withdrawals. Transactions in super accounts are no longer counted as household income or spending, in recurring payments or forecasts, or in the personal tax estimate (tax paid inside a fund is not PAYG, and fund earnings aren't personal income).
- **Super fund statements import properly.** "Opening/Closing account balance" rows are read as balances, not transactions; amounts in the Total column keep their signs (investment returns are money in); fee and tax lines printed without dates are imported; and contributions are categorised from the statement's own columns (Employer SG, Employer additional, Member before-tax, Member after-tax). Imported super transactions feed the Super screen (contribution caps, fees, returns, tax in the fund, balance history).
- Corrections in super accounts no longer teach rules that would affect bank accounts (an employer's name means salary in a bank account but a contribution in a super fund).
- The built-in Centrelink rule no longer matches company names containing "Services Australia" (e.g. "Example Web Services Australia Pty Ltd").
- **Accounts:** a stored account number can be removed; editing an account no longer clears its BSB; a newly added account now appears straight away in the import screen's account list.
- **Automatic learning** explained in set-up as data analytics and rules-based learning (not AI), with the switch right there.

## 0.3.0 — 1 October 2026

- **Recovery key for a forgotten password.** At set-up (or any time in Settings › Privacy & security), Geranium makes a one-off recovery key. Keep it by saving a file, printing it, or **Email it to myself** (opens a draft in your own email app — Geranium sends nothing). If you forget your password, choose "Forgotten your password?" on the lock screen, enter the key and pick a new password. It also helps when moving to a new computer.
- Download page: plainer explanation of the optional SHA256SUMS.txt file.

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
