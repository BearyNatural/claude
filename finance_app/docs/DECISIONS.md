# Key decisions

Short records of the choices that shape Geranium, and what each one costs.

## 1. Electron rather than Tauri

**Decision:** Electron 44 with a sandboxed renderer, context isolation, a custom `app://` protocol and hardened fuses.

**Why:** the statement-reading work depends on mature JavaScript libraries (PDF.js for positioned PDF text, SheetJS for old `.xls` files, sql.js for SQLite), and keeping the domain engine, services and UI in one language lets the same calculation code run in tests, the app and the packaged self-test. Tauri would have meant a Rust toolchain (not available on the build machine) plus either re-implementing those parsers in Rust or running them in the webview, which is exactly where untrusted files should *not* be parsed. Electron's security model, when configured strictly, is well understood.

**Cost:** larger installers (≈100–140 MB) and higher memory use than a Tauri app. Chromium security updates arrive through Electron releases, so dependency updates matter (the weekly maintenance job handles them).

## 2. SQLite through sql.js (WebAssembly), encrypted as a whole file

**Decision:** keep the database in memory with sql.js; save it as one AES-256-GCM-encrypted file, atomically.

**Why:** no native modules, so no per-platform rebuilds or ABI breakage when Electron updates, and identical behaviour in tests, development and packaged builds. Whole-file authenticated encryption is simple to reason about and verify.

**Cost:** the whole database sits in memory while unlocked and each save rewrites the file. For a household (tens of thousands of transactions, a few MB) this is fast; it would not suit very large datasets. Page-level encryption (SQLCipher) would need a native build.

## 3. Integer cents and explicit rounding

All money is integer cents with one rounding rule (half away from zero). Frequency conversions use 52 weeks, 26 fortnights and 12 months a year; averages divide by the days actually covered and scale by 365.25. This avoids floating-point drift and makes every figure reproducible.

## 4. Deterministic rules, suggestions instead of silent learning

Categorisation uses visible, editable rules (user rules beat learned rules beat defaults). When the user corrects similar transactions repeatedly, Geranium *suggests* a rule; it only creates rules automatically if the user turns that on. Nothing uses a statistical model whose decisions cannot be explained.

## 5. No bank connections

Geranium only reads files the user downloads (CSV, OFX/QFX, QIF, XLS/XLSX, PDF). No credentials, no CDR/Open Banking, no scraping. This keeps the privacy promise simple and the app usable without any third party. The cost is manual imports; the import wizard, saved profiles, duplicate detection and reconciliation are there to make that quick and safe.

## 6. No OCR

Scanned (image-only) PDFs are detected and the user is told what to do instead (download a CSV/OFX, or a text PDF). OCR engines are large, and misread digits in financial data are worse than no data. The import pipeline already flags OCR-sourced rows for review, so OCR could be added later without changing the rest of the design.

## 7. Tax rules as versioned, sourced data

Each financial year is a data file (`src/domain/tax/australia/years/`) where every component has a status — *published*, *legislated* or *provisional* — source links and a review date. Unknown future years fall back to the latest rules marked provisional. The estimator shows each step, its status and its source. Updating for a new year means adding a file and tests, not changing the estimator.

## 8. Own XLSX writer; SheetJS only for reading

Exports are built from one workbook model (`src/domain/output/workbook.ts`) and rendered to XLSX by a small OOXML writer using fflate, to Google Sheets through the API, or to CSV. The writer produces real formulas (`SUMIFS`, `SUMPRODUCT`, `PMT` checks…) with `fullCalcOnLoad`, and tests recalculate the output in LibreOffice. ExcelJS was ruled out (licence metadata problems in its dependency tree, size); SheetJS Community Edition cannot write styles. SheetJS is used only to *read* spreadsheets, installed from the vendor's CDN because the npm copy is unmaintained and has known vulnerabilities.

## 9. Dependency-free SVG charts

Charts are a few hundred lines of SVG components rather than a charting library, so every chart can have a table view, hover details, privacy-mode masking, one y-axis, and a colour palette validated for colour-vision deficiency on both themes.

## 10. Google Sheets with the user's own OAuth client and `drive.file`

Embedding a shared client secret in an open-source desktop app is not safe, and a verified public Google app requires a review process. Users create their own OAuth client (instructions are in the app); Geranium asks only for `drive.file`, which limits access to spreadsheets Geranium created.

## 11. Validated IPC surface

One IPC channel, ~150 named methods, each with a zod input schema, sender-frame checks and sanitised errors. This keeps the renderer (the part that displays untrusted text such as statement descriptions) unable to do anything the API does not explicitly allow.

## 12. vitest 3 for now

vitest 4 cannot be installed by npm 10 (bundled with Node 22, used in CI and the weekly updates) because of an npm crash resolving its optional peer dependencies. vitest 3.2.7 is kept, with a documented, time-limited OSV exception for a dev-server advisory that does not apply to how tests run here. Revisit when CI moves to npm 11.

## 13. A browser version from the same code

**Decision:** publish the existing app as a website by running its "main process" code (API, services, encrypted storage) in a Web Worker, with small shims for `fs`, `crypto` and `path`, rather than writing a second app.

**Why:** one codebase, one set of tests, identical file formats, so backups move between the website and the desktop app. The domain layer was already pure; Node-specific code was confined to six storage files. Audited `@noble` libraries provide synchronous AES-GCM and scrypt with output identical to Node's (tested).

**Cost:** the website can't use an OS keychain (always a password), can't run reminders in the background, keeps its data in browser storage that the browser or user can clear, and its code is delivered by the web host on each visit. These are documented in the app and in SECURITY_PRIVACY.md.

## 14. The name: Geranium

First released as Paperbark; renamed in 0.2.0 because many finance, budgeting and bookkeeping products already use "Paperbark". Format identifiers inside encrypted files (the key-wrapping label and the backup check value) keep the original name so existing keystores and backups still open, and the old data folder and file names are migrated on first start.
