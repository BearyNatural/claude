# 0008 — Plant data provenance

**Status:** accepted

**Decision.** Every group of fields in a plant record (windows, germination, timing, climate, site, spacing, feeding, production) cites source ids from `src/data/sources.ts`. Each record carries a review status (`draft`, `source-checked` or `expert-reviewed`) and notes. Planning heuristics are cited as `bn-heuristic`. Uncited general knowledge is cited as `general-knowledge` so it's visibly flagged. Where no reliable value was found, the field is left empty and the UI shows "Not recorded".

**Consequences.** The app can show "where this comes from" for every plant. Reviewers get a clear worklist (`docs/DATA_REVIEW.md`). Catalogue validation runs in the tests, so a record that cites an unknown source fails the build.
