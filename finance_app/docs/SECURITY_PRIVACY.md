# Security and privacy

Paperbark holds some of the most sensitive information a household has. The design goal is simple: **the data stays on the user's computer, encrypted, and nothing leaves unless the user explicitly sends it somewhere.**

## What Paperbark never does

- Log in to a bank, use Open Banking/CDR, or scrape websites. Data comes only from files the user chooses.
- Send analytics, telemetry, crash reports or "phone home" update checks.
- Store data on a server. There is no Paperbark account and no cloud copy.
- Recommend financial products or decisions.

The only network traffic the app can make is to Google, and only after the user connects Google Sheets and asks for an export (see *Network* below).

## Threat model

| Protects against | How |
|---|---|
| A lost or stolen laptop, or someone copying the data folder | Database and documents encrypted with AES-256-GCM; key protected by the OS credential store or by a password/PIN |
| Someone using the computer while Paperbark is left open | App lock (Ctrl+L), auto-lock on idle, sleep, screen lock or minimise, optional maximum session length; privacy mode hides amounts |
| A malicious or malformed statement file | Parsers treat input as data only; PDF.js is used only to extract text (nothing is rendered, PDF JavaScript is never run, XFA, font loading and network fetching are off); spreadsheet formulas are read as cached values, never evaluated; 50 MB file limit; user regex rules are limited to 200 characters and nested repetition is rejected |
| A compromised web page or injected script in the UI | Renderer is sandboxed with context isolation, strict CSP, no remote origins, all non-`app://` requests blocked, navigation and new windows blocked, permission requests denied; the API only answers the app's own frame and validates every input |
| Tampering with the installed app | Electron fuses: no run-as-node, no `NODE_OPTIONS`, no `--inspect`, app loaded only from the asar archive with integrity validation (macOS/Windows) |
| Exported spreadsheets being used for formula injection | CSV cells beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed so spreadsheet apps show them as text |

It does **not** protect against malware already running as the same user while the vault is unlocked (it can read process memory or the screen), or against someone who knows the password.

## Local storage and encryption

- Data folder: `…/Paperbark/vault` in the OS's per-user application data folder (see the README). Files are created with owner-only permissions where the OS supports it.
- **Database:** SQLite (via sql.js) in memory, written to `paperbark.pbdb` as `PBDB | format version | AES-256-GCM(iv, tag, ciphertext)`, with the header authenticated as associated data. Writes are atomic (temp file → fsync → rename) and the previous good copy is kept as `.prev`.
- **Documents:** each attached file is encrypted separately with the same key (`documents/<id>.bin`).
- **Keys:** a random 256-bit data-encryption key (DEK) is created at set-up. It is stored only in wrapped form in `keystore.json`:
  - **Operating-system protection** (default): wrapped by Electron `safeStorage` — macOS Keychain, Windows DPAPI, or Linux Secret Service/KWallet. Anyone who can sign in as this user can open Paperbark. On Linux without a keyring (`basic_text` backend) the set-up screen warns that this is weak and recommends a password.
  - **Password or PIN:** wrapped with a key derived by scrypt (N = 2¹⁷, r = 8, p = 1, random 16-byte salt). Passwords must be at least 8 characters; PINs 6–12 digits. After 5 wrong attempts each further attempt is delayed (10 s, 20 s, 40 s … up to 5 minutes). **There is no recovery**: a forgotten password means the data cannot be opened by anyone, including the developer.
  - Changing or removing the password re-wraps the same DEK; the database does not need re-encrypting.
- On lock, the database is saved, the in-memory database is closed and the DEK buffer is overwritten with zeros. (JavaScript cannot guarantee no other copies remain in memory; this is best effort.)
- Schema migrations first write an encrypted pre-migration copy.

## Application lock

- Lock manually with **Ctrl+L** (File › Lock Paperbark) or the lock button.
- Auto-lock (Settings › Privacy & security, off by default): after N idle minutes, when the computer sleeps or the screen locks, when minimised, or after a maximum session length.
- Locking closes the vault and removes all data from the UI. With **OS protection**, unlocking needs no secret — the lock only hides data from casual view. For a lock that actually stops another person, set a password or PIN.
- Privacy mode (eye button, Ctrl+Shift+H) replaces amounts with dots everywhere, including charts and tooltips. It can be the default at start-up.
- Notifications (reminders) are off until enabled, and do not include amounts unless the user turns that on.

## Backups

- **Backup & restore** writes one file (`.pbbackup`): `PBBACKUP | version | header | AES-256-GCM(zip of database + documents)`. The header holds the scrypt parameters and salt, creation date, app and schema version, and an encrypted check value so a wrong password is reported as such rather than as a damaged file.
- The backup password is separate from the app password and is never stored. The user chooses where the file goes (USB drive, NAS, a synced cloud folder). Paperbark never uploads it.
- Restore verifies the password and contents first, shows what the backup contains, keeps an encrypted copy of the current data (`pre-restore-….pbdb`), migrates older backups, then replaces the data.
- A reminder can prompt for a backup after a chosen number of days.

## Network

- The renderer cannot make network requests: CSP `connect-src 'none'`, and the session blocks every request that is not `app://`.
- The main process uses one guarded `fetch` that only allows HTTPS to `oauth2.googleapis.com`, `sheets.googleapis.com` and `www.googleapis.com`. Every request (time, host, path, status — never content) is recorded in **Settings › Privacy & security › Network log**.
- Links open in the user's own browser only for an allow-list of sites: official sources (ATO, Treasury, legislation.gov.au), Google's sign-in and consent pages, the Google Cloud console (to create an OAuth client) and Google Sheets (to open an exported spreadsheet).

### Google Sheets

- Optional. The user supplies their own Google Cloud OAuth client (desktop app type), so no shared Paperbark credentials exist.
- Sign-in uses the system browser with a loopback redirect and PKCE. Only the **`drive.file`** scope is requested: Paperbark can see and edit only spreadsheets it created, not the rest of the user's Drive.
- The refresh token is stored inside the encrypted database. Disconnecting revokes it at Google and deletes it.
- **Snapshot** exports create a new spreadsheet each time; **managed** exports update the same spreadsheet (its link is kept locally). Exports are values and formulas, never live links back to the app.

## Demo mode

Demo data is generated into an in-memory database only; nothing is written to disk and backups are disabled. Leaving demo mode discards it.

## Development and supply chain

- Dependencies are few and pinned by `package-lock.json`. SheetJS comes from the vendor's CDN at 0.20.3 (the npm registry copy is unmaintained and vulnerable).
- The repository's weekly maintenance runs gitleaks (secrets), Semgrep (`p/javascript`, `p/typescript`, `p/react`), `npm audit` (production, high), OSV-Scanner, licence allow-list checks, tests and type-check. Narrow, time-limited exceptions are documented in `osv-scanner.toml`.
- The packaged app is self-tested on each OS before release. Installers are published with SHA-256 checksums.

## Security work still needed before a public 1.0 release

1. **Code signing and notarisation.** Windows builds are unsigned (SmartScreen warning) and macOS builds are ad-hoc signed and not notarised. Obtain a Windows code-signing certificate and an Apple Developer ID, add them as CI secrets, turn on `hardenedRuntime`, and notarise.
2. **Independent security review** of the crypto and key-handling code (`src/main/crypto`, `app/state.ts`, `services/backup.ts`), the IPC surface (`api.ts`) and the file parsers, plus fuzzing of the CSV/OFX/QIF/PDF/XLSX parsers with malformed files.
3. **Update mechanism.** There is no auto-update; users must download new versions. A signed update channel (e.g. electron-updater with signature verification) should be added only with code signing.
4. **Linux AppImage sandbox.** On distributions that restrict unprivileged user namespaces, the AppImage needs `--no-sandbox`; recommend the `.deb`, or ship an AppArmor profile.
5. **Memory hygiene.** The decrypted database lives in the JavaScript heap while unlocked; sql.js cannot use locked/secure memory. Consider a native SQLCipher build if the threat model grows to include memory-scraping malware.
6. **vitest upgrade.** The dev-only advisory GHSA-82fw-gwwq-j7x9 is accepted until the CI's npm can install vitest 4 (see `osv-scanner.toml`); it does not affect the shipped app.
7. **Privacy policy and support contact** for public distribution, and a documented process for reporting vulnerabilities.
