# 0006 — Backups through OS file providers

**Status:** accepted

**Decision.** Export a versioned JSON file (`SowBySeason-Backup-YYYY-MM-DD.json`) through `expo-sharing`, which opens the system share sheet with options such as Save to Files, iCloud Drive, Google Drive, OneDrive and Dropbox. On Android there's also a Storage Access Framework directory picker ("Save to folder…"). Import uses `expo-document-picker`. The format has a schema version, stepwise migrations, an FNV-1a checksum to catch accidental damage, record-level validation, a preview, and an atomic replace.

**Consequences.** BearyNatural runs no backup service and there are no OAuth integrations. Any file provider on the phone works. Backups contain only user-created data; the catalogue and weather are recreated by the app.
