# 0003 — Local-first storage

**Status:** accepted

**Decision.**
- Store garden data on the device through a `KeyValueStore` interface backed by AsyncStorage (localStorage on web).
- **One record per key.** Validate every record when it loads, and move invalid records to `sbs:quarantine:*` instead of deleting them.
- **Generations:** a restore writes a complete new generation, checks it, then flips `sbs:meta:generation` in a single write. If the restore is interrupted, the new generation is cleaned up on the next load.
- Queue all writes one after another.

**Why not SQLite yet?** The data is small, and AsyncStorage works the same way on iOS, Android and web. The repository interface lets a later version switch to SQLite (for photos or sensor data) without touching the domain.

**Consequences.** A single corrupt record can't lose the whole garden. A restore is all-or-nothing. On Android, AsyncStorage has a total size cap, which is fine for text data. **Update (1.4):** photos are stored as separate files (IndexedDB in the browser) and records only keep the file name, so they don't count against it.
