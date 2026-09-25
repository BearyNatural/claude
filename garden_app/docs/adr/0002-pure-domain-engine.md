# 0002 — Pure domain engine; rules as data

**Status:** accepted

**Context.** The brief asks for important logic that is separate from the UI and independently testable. It also rules out hard-coding per-crop behaviour (`if plant === 'carrot'`).

**Decision.** Everything in `src/domain` is plain TypeScript with no dependencies and no I/O. Plant behaviour is described by data: zone windows, production profiles, tolerances, timing basis, companion relations and planting-system sequencing. The engine interprets that data. Time ("today") and weather are always passed in as inputs.

**Consequences.** The engine runs and is tested under plain Node (211 tests at 1.7.0), with no emulator or React. New crops and systems are mostly data additions. The UI stays thin.
