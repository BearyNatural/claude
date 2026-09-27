# Architecture

Paperbark is an Electron app with three strictly separated layers. Every financial calculation lives in a pure TypeScript domain layer that has no access to the file system, the network or Electron, so it can be tested exhaustively and reasoned about on its own.

```
┌────────────────────────────── Renderer (sandboxed Chromium) ──────────────────────────────┐
│  React 19 UI · 26 screens · charts in plain SVG · no Node, no network (CSP + request block) │
└───────────────▲──────────────────────────────────────────────────────────────────────────┘
                │ window.paperbark.invoke(method, input)   (contextBridge, one IPC channel)
┌───────────────┴────────────── Preload (sandboxed) ─────────────────────────────────────────┐
│  invoke · on(data:changed | app:locked | navigate) · activity ping · platform name        │
└───────────────▲──────────────────────────────────────────────────────────────────────────┘
                │ ipcMain.handle('api') — sender must be app://paperbark
┌───────────────┴────────────── Main process (Node) ─────────────────────────────────────────┐
│  api.ts: ~150 methods, each with a zod input schema; errors sanitised before returning    │
│  app/state.ts: locked / unlocked / demo; key management; backup & restore                 │
│  services/: imports, transactions, insights, budgeting, planning, taxes, output,           │
│             documents, reminders, backup — SQL + orchestration, no maths of their own     │
│  db/: sql.js (SQLite in WebAssembly) held in memory, saved AES-256-GCM encrypted           │
│  crypto/: seal/open, scrypt KDF, key store (OS keychain or password)                       │
│  google/: OAuth loopback + PKCE, Sheets writer · net.ts: allow-listed fetch + network log  │
└───────────────▲──────────────────────────────────────────────────────────────────────────┘
                │ plain function calls with plain data
┌───────────────┴────────────── Domain (pure TypeScript) ────────────────────────────────────┐
│  money (integer cents) · dates (AU financial years) · periods · schedules                 │
│  import/: CSV, OFX/QFX, QIF, spreadsheet, PDF statement parsing, duplicates, reconciliation│
│  categorise/: cleaning, rules, learning suggestions · transfers · recurring               │
│  analysis · budget · accounts/net worth · investments · superannuation · search           │
│  planning/: compound, goals, loans & offsets, term deposits, forecast & scenarios         │
│  tax/australia/: versioned year rules, sources, estimator · cgt · gst · payslips          │
│  output/: workbook model → XLSX (own OOXML writer) / Google Sheets / CSV                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Rules the layers follow

- **Money is integer cents** everywhere (`Cents = number`), rounded half away from zero once per calculation step. Formatting happens only at the edges.
- **Dates are ISO strings** (`YYYY-MM-DD`), with day arithmetic in UTC so daylight saving never shifts a date. Australian financial years (`2025-26`) are first-class.
- **The domain never reads a clock.** "Today" is passed in, which makes every calculation reproducible in tests (the demo and tests use fixed dates).
- **Imported originals are never changed.** Descriptions are cleaned into separate fields; edits are recorded in `change_history` with who/what/why.
- **Scenarios never touch history.** Forecasts are computed from assumptions; saved snapshots store the result so later changes can be compared against it.
- **Explanations travel with numbers.** Averages, forecasts, tax steps and budgets return their basis (period, transaction count, assumptions, sources) so the UI can show "How was this calculated?".

## Data model (SQLite, schema v1)

Tables: `accounts`, `balance_snapshots` (dated balances with a source: imported / manual / estimated / calculated), `transactions` (original and cleaned description, amount, category, income type, one-off flag, status posted/staged/rejected, import id), `transaction_splits`, `tags`, `transaction_tags`, `transfers` (matched pairs), `change_history` (who/what/why for every edit), `categories`, `rules`, `dismissed` (suggestions the user declined), `imports` (file hash, reconciliation result, rejected rows, warnings), `import_profiles`, `recurring`, `bills`, `sinking_funds`, `budgets`, `budget_lines`, `goals`, `loans`, `term_deposits`, `securities`, `trades`, `dividends`, `valuations`, `super_entries`, `payslips`, `tax_entries`, `scenarios`, `scenario_snapshots`, `documents` and `document_links` (metadata; the bytes are separate encrypted files), `reminders_sent`, `exports` (Google Sheets links for managed exports), `settings`, `meta`.

Schema changes go through `db/schema.ts` → `migrate(db, beforeMigrate)`. Before any migration an encrypted copy of the database is written (`pre-migration-v<from>-<date>.pbdb`). Backups record their schema version and are migrated on restore.

## Storage

`AppDatabase` keeps the SQLite database in memory (sql.js) and writes it to disk after changes (debounced, and immediately on lock/quit):

1. `export()` the database bytes.
2. Encrypt with AES-256-GCM under the data-encryption key; the file header (`PBDB` + format version) is authenticated as associated data.
3. Write to a temporary file, `fsync`, keep the previous file as `.prev`, then rename into place. A damaged main file falls back to `.prev`.

See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) for keys and locking.

## IPC and API

- One channel (`api`), one entry point (`dispatch`). Each method has a zod schema; unknown methods and invalid input are rejected before any service code runs.
- Only frames loaded from `app://paperbark/` may call it. Everything except a small public set (status, set-up, unlock, lock, demo, network log) requires an unlocked vault.
- Errors thrown as `UserError` carry a message written for people; anything else is logged in the main process and returned as *"Something went wrong and this action was not completed."* — stack traces and file paths never reach the UI.
- After a change, services call `changed(area)`; the main process batches these and emits `data:changed` so screens reload what they show.

## Renderer

- Served from a custom `app://paperbark` protocol (read with `fs` from the packaged `dist/renderer`, path-checked), with a strict Content-Security-Policy (`default-src 'none'`; scripts only from the app itself; `connect-src 'none'`; inline styles allowed because React sets style attributes; no remote origins at all).
- `lib/api.ts` provides `useApi` (load + reload on `data:changed`), `useAction` (pending/error state) and a small shared cache for categories/accounts.
- Components: `Page`, `Card`, `Stat`, `Callout`, `Explain`, `DataTable` (sortable, keyboard-selectable), `Dialog`/`Drawer` (focus trap, Esc), form fields with labels and hints, `Money` (respects privacy mode).
- Charts (`components/charts.tsx`) are dependency-free SVG: column, line/area, bar list, meter. Each has a legend when there is more than one series, hover details, and a **Show as table** view. Colours come from a palette validated for colour-vision deficiency on the light and dark surfaces.

## Build and packaging

- `scripts/build.mjs`: esbuild bundles the main process (CommonJS; `electron`, `sql.js`, `pdfjs-dist` and `xlsx` stay external because they ship wasm/worker files) and the preload; Vite builds the renderer into `dist/renderer`.
- `electron-builder.yml`: asar packaging, trimmed dependencies, hardened Electron fuses (no run-as-node, no `NODE_OPTIONS`, no inspector flags, asar integrity, load app only from asar, cookie encryption), NSIS (Windows), dmg (macOS, ad-hoc signed), AppImage + deb (Linux).
- `paperbark --self-test` runs inside a packaged build and checks the encrypted database, the finance engines with demo data, PDF.js text extraction and XLSX write/read, then exits 0/1. CI runs it on every packaged OS.

## CI

- `ci/finance_app-ci.yml` → `.github/workflows/`: tests, type-check, production build, Linux package and packaged self-test on every change to `finance_app/`.
- `ci/finance_app-desktop.yml`: builds Windows, macOS and Linux installers, self-tests each, and publishes a pre-release tagged `finance_app-v<version>-build<n>` with SHA-256 checksums.
- The repository's weekly maintenance workflow runs gitleaks, Semgrep, `npm audit`, OSV-Scanner (exceptions in `osv-scanner.toml`), licence checks, tests and type-check, and updates dependencies.
