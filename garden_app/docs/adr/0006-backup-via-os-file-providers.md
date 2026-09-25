# 0006 — Backups through OS file providers

**Status:** accepted

**Decision.** Export a versioned JSON file (`SowBySeason-Backup-YYYY-MM-DD.json`) through `expo-sharing`, which opens the system share sheet with options such as Save to Files, iCloud Drive, Google Drive, OneDrive and Dropbox. On Android there's also a Storage Access Framework directory picker ("Save to folder…"). Import uses `expo-document-picker`. The format has a schema version, stepwise migrations, an FNV-1a checksum to catch accidental damage, record-level validation, a preview, and an atomic replace.

**Update (1.6): automatic backup.** On Android the gardener can pick a folder once (Storage Access Framework; the folder permission is kept), and the app rewrites `SowBySeason-AutoBackup.json` there shortly after each change. Picking a Google Drive or OneDrive folder gives an automatic cloud copy with no OAuth or BearyNatural service involved. Browsers can't write to a folder by themselves, so the browser version keeps manual backups.

**Consequences.** BearyNatural runs no backup service and there are no OAuth integrations. Any file provider on the phone works. Backups contain only user-created data; the catalogue and weather are recreated by the app.
