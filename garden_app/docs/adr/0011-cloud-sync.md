# 0011 — Sync through the gardener's own cloud storage

**Status:** accepted · 2026-10-01

**Context.** Gardeners use the Android app and the browser version and want the same garden in both, in any browser (including Firefox and Safari) and on Macs. The app is local-first with no BearyNatural server.

**Decision.** Optional sync through the gardener's own **Dropbox** (app folder) or **Google Drive** (`drive.file`: only files the app created). One file, `SowBySeason-Sync.json`, in the normal backup format without photos. Each device merges it record by record (newest change wins; deletions are recorded and carried across; device-only settings stay local) and uploads the result when the other copy is behind. Sign-in uses PKCE with public app ids — no client secrets anywhere in the app. Not offered: OneDrive (Microsoft no longer allows app registration from personal accounts without a directory) and iCloud Drive (needs a paid Apple developer account; no browser API without CloudKit).

**Consequences.** No server, no account with BearyNatural, and data stays in the gardener's own storage. Sync isn't instant (it runs on open, after changes and every few minutes), and the same record edited on two devices before they sync keeps only the latest edit. Photos stay per device. Google in the browser needs a click to reconnect about hourly; while the Google project is in Testing, sign-ins last 7 days and only listed test users can connect.
