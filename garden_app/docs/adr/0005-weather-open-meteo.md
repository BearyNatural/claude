# 0005 — Weather via Open-Meteo; honest freshness

**Status:** accepted

**Decision.** Use the Open-Meteo forecast API. It needs no key for non-commercial use and covers Australia with daily min/max, rain, rain probability and hourly modelled soil temperature at 6 cm. Coordinates are rounded to 2 decimal places. The last snapshot is cached with `fetchedAt`. Freshness is always computed: fresh ≤ 3 h, stale ≤ 48 h (used with a caveat), and unavailable after that. Soil temperature is labelled "modelled (estimated)". Air temperature is never used in its place.

**Alternatives.** The Bureau of Meteorology has no supported public forecast API for apps. Commercial weather APIs would need a key and a server-side proxy to keep it secret.

**Consequences.** A commercial release needs an Open-Meteo subscription (`EXPO_PUBLIC_OPEN_METEO_API_KEY`). Weather refines the seasonal advice but never replaces it.
