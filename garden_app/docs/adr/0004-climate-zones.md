# 0004 — Climate zones

**Status:** accepted

**Context.** Advice has to differ between Brisbane, Hobart, Darwin, Perth and inland Queensland. Australian gardening references mostly use five broad zones.

**Decision.** Use the zones `tropical`, `subtropical`, `warm-temperate`, `cool-temperate` and `arid` (arid includes semi-arid). Gardening Australia's "Temperate" zone maps to warm-temperate and its "Cool" zone maps to cool-temperate, following example towns in ABC Organic Gardener and The Seed Collection. A separate **frost-exposure** setting (none, light, moderate or heavy) captures inland and highland differences that the zone alone misses. The app suggests both from the nearest reference town, flags high elevation, and lets the gardener override both.

**Consequences.** The zones are coarse by design, and the override handles microclimates. Postcode-only guesses are marked as low confidence.
