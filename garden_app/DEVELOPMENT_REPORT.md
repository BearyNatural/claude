# Development report: Sow by Season (by BearyNatural)

*Build date: 24 September 2026 · App version 1.0.0 · Plant data 2026.09.1*

## Summary

I built a complete Expo / React Native app in TypeScript. It has a **tested, dependency-free gardening engine**, a sourced Australian plant catalogue of 52 plants, local-first storage that survives corrupt records, safe backup and restore, local reminders, and 23 connected screens. **150 automated tests pass.**

One limitation shapes the rest of this report. My build environment could not reach the npm package registry (the network egress policy blocked it throughout the session), so I could not run `npm install`, Expo, or the Android and iOS builds. To make up for that, I did three things:

- I tested everything that doesn't need React Native under Node.
- I type-checked the screens against the app's own component interfaces.
- I rendered the real screens, store, engine and storage in a headless Chromium browser through a thin stand-in for React Native, walked through onboarding and a seeded garden, and captured screenshots (`docs/screenshots/`).

**Running it on a phone is the first job for you** (see [Recommended next work](#recommended-next-work)).

---

## What I built

| Area | What works |
|---|---|
| **Garden Profile** (no account) | Suburb/postcode/state, timezone, approximate coordinates, suggested climate zone *and* frost exposure (from the nearest reference town, with a high-elevation warning), overrides for both, household size, weekly time, goals, gardening days and reminder preferences |
| **Location** | About 155 offline reference towns; online place search (Open-Meteo); manual state + zone; postcode → state (including ACT and NT edge cases); Broken Hill timezone. GPS is never used, and location permissions are blocked in `app.json` |
| **Garden areas** | 12 area types. Only a name is required. Optional size, sun hours, soil type, drainage, soil observations, irrigation and container size. Shows usage, overcrowding, companion and soil tips |
| **Plant catalogue & search** | 52 plants (vegetables, herbs, fruit and fruit trees, perennials, pollinator flowers, one native, one green manure). Search understands queries like "fruit trees", "suitable for pots", "things I can plant now", "subtropical vegetables", "plants for a trellis" and "pollinator plants" |
| **Plant detail** | Current recommendation with reasons, the planting window for your zone (plus other zones for comparison), quantity for your household, growing needs, soil preparation with do/avoid and the reason, timing and size, companions with evidence levels, care notes, **sources and review status**, and "don't recommend this plant" |
| **Plantings** | Add something growing, just sown, or planned. Start method, variety, quantity (with a suggested amount), area, date and **date accuracy** ("sometime around early September"). Live checks for season, space, sun, pot size, rotation and companions — advice only; you can always save |
| **Timeline & journal** | Estimated germination, transplanting, flowering, first harvest, end of productive period, and years to first crop, all shown as ranges. Recording a real event replaces the estimate and shifts later estimates. Journal notes appear in the timeline. The growth stage is estimated, or you can set it yourself |
| **Plant Now** | Great time / Can plant / Soon / Better to wait / Outside season / No data, each with **reasons** covering season, climate, frost, heat, rain, soil temperature, garden, space, sun, goals, time and wish list |
| **This Week** | Jobs worked out from your garden, grouped as Protect / Harvest / Plant / Care / Prepare, with Important / Soon / Optional priority, estimated minutes, a weekly time budget, "If you only have one hour…", *Can wait*, and Done / Skip / Snooze / Next gardening day / Not relevant |
| **Succession planting** | Proposal sized to your household, space and time, stopping when the regional window closes (including windows that cross the new year). Accept (creates a planting), postpone, skip, change quantity (optionally for later batches too) and stop, with automatic recalculation |
| **Three Sisters** | A structured system with roles, functions and **sequencing** (beans and pumpkin go in when the corn is about 15 cm tall), checked against each crop's window, a space check, and a cultural note. Planned steps become planned plantings and tasks |
| **Seasonal calendar** | 12 months from now showing Sow/Plant/Flowering/Harvest letters (not colour alone), plus a list of what's coming up (succession sowings, planned plantings, estimated milestones, tasks) |
| **Wish list** | Messages that combine the season, available space and sun, e.g. "Garlic is on your wish list. Your recommended planting period starts in about 6 months." |
| **Reminders** | Grouped per gardening day, daily or weekly; quiet days respected; separate frost and heat alerts; preview; permission handling |
| **Backup & restore** | Versioned JSON with checksum; OS share sheet / Android folder picker / web download; document picker; validation, migration, preview, warning and atomic replace |
| **Privacy** | Plain-language privacy screen, weather on/off, delete all data |
| **Education** | 21-term glossary with contextual "?" tips; an About screen with every source and data-quality counts |
| **Accessibility** | Icon + text status, 48 px touch targets, labelled controls, adjustable steppers, WCAG AA colours in light and dark themes |

## Architecture

The main choices (details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/adr/`](docs/adr/)):

1. **Expo SDK 57 + expo-router + TypeScript (strict).** One codebase for iOS, Android and web ([ADR 0001](docs/adr/0001-expo-react-native.md)).
2. **A pure domain engine with rules as data.** `src/domain` has no React, no I/O and no dependencies, which is why the whole engine runs under Node's test runner. Plant behaviour comes from data (windows, production profiles, tolerances, timing basis, companion relations, system sequencing), not per-crop code ([ADR 0002](docs/adr/0002-pure-domain-engine.md)).
3. **A small observable store** instead of Redux/Zustand. Every action applies a domain rule, persists through the repository and notifies screens. `useGardenView()` runs the engine once for all screens, so Plant Now, This Week, the calendar and reminders all read the same picture of the garden.
4. **Resilient local-first storage.** One record per key, validation on load, quarantine for bad records, writes queued one at a time, and atomic generation swaps for restore ([ADR 0003](docs/adr/0003-local-first-storage.md)).
5. **Honest weather.** Every snapshot is timestamped and classed as fresh, stale or unavailable. Soil temperature is labelled as modelled. Weather refines seasonal advice and never replaces it ([ADR 0005](docs/adr/0005-weather-open-meteo.md)).
6. **Built for later.** The `Observation` records (sensor, area, planting, timestamp) are already in the model and in backups for future IoT. Areas have dimensions and plants have mature sizes for a future visual planner. Planting systems are data for future guilds and rotations.

## The gardening engine

**Planting recommendations** (`recommend.ts`). The base is the zone's planting window, on a circular calendar so it can cross the new year. Then local frost exposure (works offline), the forecast (frost, bolting heat, extreme heat for heat-sensitive crops, heavy rain before direct sowing) and modelled soil temperature against the plant's germination minimum, optimum and maximum refine the result. Garden context, goals, time and the wish list adjust the ranking. **Every change adds a plain-language reason.** Where no source exists, the result is "No local timing data yet" rather than a guess.

**Household planning** (`production.ts`): `(household base + per person × people) × goal level × time factor`, capped per crop. Single-harvest roots scale per person, per batch. Prolific repeat croppers are capped (zucchini ≤ 4). Long-lived plants never scale (one lemon tree). Cut-and-come-again greens scale gently. Results are rounded and always presented as "approximately …, a planning estimate". For a household of 4 at the "some" level, carrots come out at about 20–30 per batch, which matches the brief's example.

**Succession planting** (`succession.ts`). The interval comes from the crop's range (the long end for small time budgets, the short end when you're maximising). Batches stop when the window closes, and the number of batches is capped by your time budget. Batch size shrinks to fit the free area. Accept, postpone, skip, resize and stop all recalculate only the future batches. Tested examples: carrots in Brisbane from 24 September → sowings on 24 Sep, 22 Oct and 19 Nov, stopping because the window ends 30 Nov; lettuce in Hobart from 20 November, continuing into 2027 until April.

**Weather** (`weather.ts`, `services/weather`). Open-Meteo 7-day daily forecast plus hourly soil temperature at 6 cm (averaged per day, and only when at least 12 hours are available). Cached with its fetch time; fresh ≤ 3 h, stale ≤ 48 h with a caveat, unavailable after that. Past forecast days are ignored. Forecast rain prompts "check soil moisture" and is never treated as watering. The service returns the cached snapshot along with an error message when you're offline.

**Companions** (`companions.ts`). 24 relationships, each with functional reasons and an evidence level (established, plausible or traditional). Category relationships work too (pollinator plants help cucurbits). Area checks flag pairs growing together (e.g. potato + tomato → keep apart because of shared diseases). Marigold nematode claims and the idea that alliums stunt beans are labelled traditional, with the caveats spelled out.

**Planting systems** (`systems.ts`). Three Sisters: corn goes in first; climbing beans and pumpkin follow 14–21 days later, "when the corn is about 15 cm tall" (Cornell). Each step is checked against its crop's window, and late starts are flagged; for example, starting in Hobart in late November puts the pumpkin outside its window. New systems can be added as data.

**Also:** crop-family rotation warnings, overcrowding / sun / pot-size checks, timelines where real events override estimates, deterministic tasks and time-aware weekly planning, and grouped reminders.

## Data

**Where the plant information came from** (all sources are in `src/data/sources.ts` and shown in the app):

- **ABC Gardening Australia Vegie Guide.** I captured all 60 monthly lists (5 zones × 12 months) into `data-sources/`, and a script turns them into planting windows for 38 catalogue plants.
- **The Seed Collection sowing chart** (an Australian seed supplier): spacing, sowing depth, germination days, days to maturity, frost tolerance, and windows for herbs and flowers.
- **Oregon State University Extension** (UC Davis data): germination soil temperatures.
- **Sustainable Gardening Australia** (strawberries, potatoes, sweet potato, figs), **NSW DPI** (citrus), **Gardening Australia fact sheets** (passionfruit, garlic), **NT Government** (mango), **Australian Blueberry Growers' Association**, **Cornell** (Three Sisters), **Mississippi State University Extension** (companion evidence), and **ABC Organic Gardener / The Seed Collection** (zone example towns).

**Still needs horticultural review:** see [`docs/DATA_REVIEW.md`](docs/DATA_REVIEW.md), which has a per-plant table. The main items:

- heat and bolting thresholds, feeding intervals, amendments and common problems (mostly general knowledge);
- **all household quantities and succession intervals** (BearyNatural heuristics);
- arid-zone windows (very broad in the source);
- a few Gardening Australia oddities that I kept or overrode (garlic in the cool zone, sweet potato in temperate zones);
- 129 of the 156 town zone assignments;
- companion evidence levels.

**Assumptions I made:**

- Gardening Australia's Temperate zone = warm temperate, and its Cool zone = cool temperate.
- The Seed Collection chart lists row spacing before plant spacing (checked against its legend).
- "Days to maturity" for transplanted crops counts from transplanting, following seed-catalogue convention. The source doesn't say, so this is flagged.
- The frost-risk forecast threshold is ≤ 2 °C (air temperature), extreme heat is ≥ 35 °C, and heavy rain is ≥ 25 mm/day.
- "After last frost" was interpreted as month ranges; these are noted on the records.

I left fig and mango planting months, rosemary's window, fig's years to first crop, and several mature sizes **unknown** rather than inventing them.

## Testing

**Tests created:** 150 tests in 8 files (`npm test`), all using Node's built-in test runner via `tsx`.

| File | Covers |
|---|---|
| `dates-seasons.test.ts` | Garden timezone vs UTC (Brisbane, Perth, Darwin), NSW daylight saving vs QLD, unknown timezones, leap years, crossing the new year, week keys, AU seasons (summer Dec–Feb …), tropical wet/dry, windows that wrap the year, closing/opening dates, all-year windows |
| `location-catalogue.test.ts` | Postcode → state (ACT/NT/Queanbeyan), Broken Hill timezone, coordinate rounding, offline search, zones for Brisbane/Hobart/Darwin/Perth/Longreach, low-confidence guesses, elevation warning, reference data sanity; catalogue validation, required crops, "unknown stays unknown", production styles; search queries |
| `recommend-weather.test.ts` | Different advice in July for Darwin/Brisbane/Perth/Hobart/inland QLD, advice differs across zones, every result has reasons, no zone, unsuited climate, no data, end of window, goals/wish list/low-maintenance, succession due, no space; **fresh/stale/unavailable weather**, stale caveat, seasonal fallback, past days ignored, frost, bolting, soil temperature (never air temperature), seed-tray suggestion, heavy rain, heat nuance |
| `production-succession.test.ts` | Household scaling, the brief's carrot example, zucchini cap, the lemon tree doesn't scale, herbs, cut-and-come-again vs single-harvest, time budget, estimate wording, rounding; succession stops at the window end, crosses the new year, time limits, intervals, space limits, unsuitable crops; accept/postpone/skip/resize/stop/complete; singular/plural units |
| `garden-intelligence.test.ts` | Three Sisters sequencing, functions, late-start warnings, cool zone; companion reasons/evidence/category expansion/area pairs; space (4 zucchini in 1 × 1 m), vague areas, overcrowding, sun, pots; rotation; timelines (estimates, actual events shift later estimates, approximate dates widen ranges, seedling head start, journal, stage, perennials, no invented milestones); timing basis; calendar |
| `tasks-workload.test.ts` | Transplant/thin/stake/harvest from planting state; weather-aware watering (never says "has been watered"); frost/heat only when relevant plants exist; wish-list prompts; succession tasks; Three Sisters step trigger; done/snooze/skip; no duplicate ids; ranking; one-hour gardener; generous budget; important jobs over budget without "overdue" language; reminders grouping, quiet days, urgent frost, daily mode, no past reminders; **the integrated scenario from the brief** |
| `backup-storage-weather.test.ts` | Filename, round trip, no catalogue in backups, stable checksum; empty/non-JSON/truncated/wrong-format/too-new/bad-version/too-old/checksum-corrupt files; bad records skipped; dangling area references; **v1 → v2 migration**; storage save/load, invalid records rejected, **corrupt record quarantined while the rest loads**, **atomic restore under a simulated write failure**, validation before any write, orphan cleanup, delete everything; weather URL, parsing, modelled soil, bad responses, offline cache, HTTP errors, location mismatch |
| `store.test.ts` | Store actions end to end with in-memory storage: offline start, events → stage, wish list, task responses, succession accept → planting, refusal with a reason, Three Sisters planned steps + marking them sown, area removal keeps plantings, restore, delete all |

**Tests passed:** 150 of 150. `tsc` strict type-check of the engine, data, services and store also passes (`npm run typecheck:domain`).

**Known failures:** none in the test suite. Earlier in development, a few *test expectations* had the arithmetic wrong (for example, how many carrots fit in 0.2 m²). I corrected the expectations after checking the engine's maths by hand; I didn't change the engine to make those tests pass. Where screenshot review showed real behaviour problems — every plant being downgraded by a single hot day, "1 plants", tomato harvest estimates that were too early, the "next milestone" wording — I **fixed the engine and added tests** for each.

**Other verification I did:**

- The screens and hooks were type-checked against their own interfaces, with minimal React Native type stubs. The only errors were artefacts of the stubs.
- The headless-browser walkthrough (onboarding → seeded garden → 18 screens including dark mode and offline weather) produced **no runtime errors** apart from the deliberately blocked weather request.
- Colour contrast was checked with a script: every text/background pair is ≥ 4.5:1 in both themes.

**Native-device features that still need manual testing:**

- `npm install`, `npx expo install --fix`, `npx expo-doctor`, then `expo start` on Android, iOS and web (react-native-web layout may differ from my stand-in).
- Local notifications: permission prompts on Android 13+ and iOS, the Android channel, scheduled delivery, quiet days.
- Backup export through the iOS share sheet (Save to Files / iCloud Drive), Android share targets (Google Drive, OneDrive, Dropbox), the Android "Save to folder…" option (SAF `Directory.pickDirectoryAsync`, which the code checks for before use), web download.
- Importing a backup from iCloud, Drive or local storage with the document picker.
- AsyncStorage persistence across restarts and the app being killed.
- Screen readers (TalkBack, VoiceOver), large system font sizes, dark mode on devices, safe-area insets.
- Live Open-Meteo forecast and geocoding requests from a device (the tests use recorded response shapes).
- Running the app in Expo Go, and an EAS development build.

## Privacy & storage

- **What's stored:** the Garden Profile (location as suburb/postcode/state, rounded coordinates and timezone; zone and frost with any overrides; household; time; goals; reminder preferences), garden areas, plantings with their event history, journal notes, wish list, succession plans, task responses, observations, settings, and the cached weather forecast.
- **Where:** on the device, in AsyncStorage (localStorage in the web preview), one record per key. Nothing is stored on a BearyNatural server, because there isn't one.
- **What leaves the device:** only (a) rounded coordinates and timezone sent to Open-Meteo's forecast API when weather is switched on, and (b) search text sent to Open-Meteo's geocoding API when you choose "Search more places online". There's no analytics, advertising, account or push service.
- **How backup works:** a JSON file (`SowBySeason-Backup-YYYY-MM-DD.json`, schema v2 with a checksum) goes wherever you choose through the phone's own file providers. Restoring validates the file, checks it's a Sow by Season backup, checks the version, migrates older versions, verifies the checksum, validates every record, shows a preview and warning, then replaces the data atomically. Corrupt files are refused with the current garden untouched.

## Known limitations

- **I couldn't install packages, run Expo, or build for devices here** (see the summary). The versions in `package.json` came from the Expo SDK 57 documentation, so run `npx expo install --fix` first.
- Reminders can't react to forecast changes while the app is closed, because the OS doesn't guarantee background execution. This is explained in the app.
- Planting windows are month-level, from broad regional guides. The five zones plus frost exposure are coarse, so microclimates rely on the gardener's overrides.
- Arid-zone advice is the least precise.
- The catalogue has 52 plants. Many secondary fields are general knowledge awaiting review, and all quantities are heuristics.
- The offline location list covers about 155 towns. Other suburbs need online search or a low-confidence postcode guess.
- The date entry is a validated text field (no native date-picker dependency yet).
- There's one planting system (Three Sisters). Crop rotation is a warning, not a full planner.
- Soil temperature is modelled, not measured, until sensor support is added.
- A commercial release needs an Open-Meteo API subscription.

## Recommended next work

1. **Run it on devices.** Install, run `expo install --fix` and `expo-doctor`, then test on Android, iOS and web. Work through the manual checklist above (notifications, share sheet and SAF export, document-picker import, screen readers, large fonts). Add React Native Testing Library tests for the main screens.
2. **Horticultural review** of `docs/DATA_REVIEW.md`, especially the quantities, succession intervals, bolting and heat thresholds, arid windows and town zones. Then tune the heuristics.
3. **Grow the catalogue** using the same provenance pattern: more natives, more fruit trees with chill hours, green manures, and Asian greens. Add variety-level data where seed suppliers publish it.
4. **Improve locations:** bundle a full postcode/locality dataset (with a licence check) and an optional sub-zone or elevation-aware frost model.
5. **Improve reminders:** add an optional background-fetch refresh for weather alerts (still best-effort), notification actions ("Done" from the notification), and a native date picker.
6. **Harvest logging and yields** using `Observation` (harvest weight), which later supports grocery-savings estimates.
7. **More planting systems and a rotation planner:** green-manure breaks, bed rotation sequences, pollinator strips, fruit-tree guilds.
8. **Sensors:** a sensor service that writes `Observation`s, with the engine preferring measured soil temperature and moisture.
9. **Photos** on plantings and journal entries, with a zip backup format (a schema v3 migration).
10. **Commercial readiness:** Open-Meteo subscription, privacy policy URL, store listings, accessibility audit, crash reporting that sends no garden data.
