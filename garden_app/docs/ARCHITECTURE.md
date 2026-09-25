# Architecture

## Layers

```
 ┌──────────────── app/ (screens, expo-router) ────────────────┐
 │  read state via hooks · call store actions · render results │
 └──────────────▲─────────────────────────────┬────────────────┘
                │ useGardenView()             │ actions
 ┌──────────────┴──────── src/state ──────────▼────────────────┐
 │ GardenStore: holds GardenData + weather; each action =      │
 │ domain rule + validated persistence + notify                │
 └───────▲──────────────────────▲──────────────────▲───────────┘
         │                      │                  │
 ┌───────┴──────┐   ┌───────────┴─────────┐  ┌─────┴──────────────┐
 │ src/domain   │   │ src/services        │  │ src/data           │
 │ pure TS      │   │ storage · weather · │  │ catalogue, sources,│
 │ engine       │   │ location · notif. · │  │ localities,        │
 │ (no I/O)     │   │ backup · photos ·   │  │ postcodes, systems,│
 │              │   │ updates · alerts    │  │ companions, glossary│
 └──────────────┘   └─────────────────────┘  └────────────────────┘
        ▲
        └── src/widget (Android home-screen widget) and the background
            weather check read saved data directly, without the app open
```

- **Domain** (`src/domain`) has no dependencies at all. Every rule there is a pure function over data, which is why the whole engine is tested in plain Node.
- **Data** (`src/data`) holds the horticultural knowledge as structured records, each with provenance.
- **Services** wrap the outside world behind small interfaces: `KeyValueStore`, `FetchLike`, the notification API and the file APIs. The storage and weather services are tested with in-memory fakes. Where the browser needs different code, a `*.web.ts` file sits next to the native one (photos in IndexedDB, no background tasks, no automatic backup folder), and the bundler picks the right one.
- **State** combines the domain and the services. `useGardenView()` runs the engine (Plant Now, tasks, the week plan) with memoisation, so every screen sees the same computed picture.
- **UI** components are presentational. The screens don't contain gardening rules.

## How the features work together

Every recommendation is built from the same inputs:

```
location → climate zone (+ override) + frost exposure ┐
current date in the garden's timezone                │
weather assessment (fresh / stale / unavailable)     │
modelled soil temperature (labelled as modelled)     ├─► recommend.ts  → Plant Now
garden areas (size, sun, pots)                       │   tasks.ts      → This Week
plantings + their timelines (estimated/actual)       │   workload.ts   → time-aware plan
succession plans · planting-system steps             │   reminders.ts  → grouped notifications
wish list · goals · household size · time budget     ┘   calendar.ts   → seasonal calendar
```

For example, the integrated test in `tests/tasks-workload.test.ts` checks this scenario from the brief: a subtropical garden, 3 people, a 4 × 1 m sunny bed, lettuce already planted, carrots on the wish list, 1–2 hours a week, and warm weather approaching. Carrots come out as *Great time* with a positive soil-temperature reason and a batch sized for the household. Lettuce is held back because of the bolting risk. A carrot succession plan is capped for limited time. This Week puts the lettuce harvest first within about 90 minutes.

## The horticultural engine

### Planting windows (`windows.ts`)
Each zone's windows are stored as sets of months. Many Australian windows cross the new year (for example Nov–Feb), so the logic works on a circular calendar. It gives: in or out of the window, the phase (opening, middle, closing), the closing date, and the next opening date.

### Plant Now (`recommend.ts`)
1. **Season:** zone window → *Great*, *Can plant* (the window closes within 3 weeks), *Soon* (opens within 6 weeks) or *Outside*. When no zone data exists the result is *Unknown*, and the app never guesses. `suitableZones` marks crops such as mango as not suited to a climate.
2. **Local frost (works offline):** frost-tender crops in winter where frost exposure is moderate or heavy → *Better to wait*.
3. **Forecast** (only when the weather is fresh or stale, never unavailable; stale weather adds a caveat):
   - frost ≤ 2 °C in the next 7 days → frost-tender crops wait;
   - bolting-prone crops wait when the forecast maximum goes above their threshold;
   - a ≥ 35 °C day within 3 days demotes heat-sensitive crops, while heat-tolerant crops just get a note;
   - ≥ 25 mm of rain within 2 days demotes direct sowing.
4. **Soil temperature:** modelled 6 cm soil temperature is compared with the germination minimum, optimum and maximum. Too cold → wait, with seed trays suggested where possible. When soil data is unavailable the app says so. Air temperature is never relabelled as soil temperature.
5. **Garden context:** whether the next succession batch is due, the crop is already growing, the areas are full, or there isn't enough sun.
6. **Goals, wish list and time** adjust the ranking, and every adjustment adds a reason.

The output is a category, a headline, a **list of reasons**, a suggested start method and a quantity estimate.

### Weather (`weather.ts`)
Each snapshot stores `fetchedAt`. Freshness is **fresh** (≤ 3 h), **stale** (≤ 48 h, used with a caveat such as "Based on a forecast from 10 hours ago") or **unavailable** (older, missing or failed). Past forecast days are ignored. Rain forecasts produce "check soil moisture" advice and are never treated as watering.

### Household production (`production.ts`)
```
plants per batch ≈ (householdBase + plantsPerPerson × people) × level × time
```
- `level` comes from the goals: some 0.6 · supplement 1.0 · maximise 1.5. It doesn't apply to long-lived plants.
- `time` reduces medium- and high-maintenance crops for small time budgets.
- `maxPlantsPerHousehold` caps prolific crops, so zucchini never goes above 4.
- Long-lived plants use a fixed household base, so it's always one lemon tree.
- Numbers are rounded to practical figures and always shown as "approximately …, a planning estimate".

### Succession (`succession.ts`)
The interval comes from the crop's range. A small time budget gets the longer interval, and "maximise" gets the shorter one. Batches repeat until the **end of the current window run** (which can cross the new year), a horizon, or a batch cap set by the time budget. Batch size shrinks to fit the free area. The stored plan supports **accept** (creates a planting and re-anchors later batches), **postpone** (shifts later batches and drops any that fall after the window), **skip**, **resize** (optionally for later batches too) and **stop**. `recalculate()` rebuilds only the future batches.

### Timelines (`timeline.ts`)
Milestones are germination, ready to transplant, flowering, first harvest and end of the productive period, or years to first crop for perennials. They're computed from the planting date, the start method and the plant's timing data. `timing.basis` records whether flowering and maturity figures count from sowing or from transplanting; seed catalogues count transplanted crops from transplanting. An approximate planting date widens the ranges by ±7 or ±15 days. When the gardener records a real event, the estimate is replaced and **later estimates shift** by the difference. The growth stage is estimated unless the gardener sets it.

### Tasks and workload (`tasks.ts`, `workload.ts`)
Tasks come from the garden's state: transplanting, thinning, grouped watering of new plantings (with a weather-aware message), harvest checks, feeding at intervals, staking, mulching, hilling, frost and heat protection, heavy-rain checks, succession sowings, planting-system steps, wish-list prompts and a weekly walk-around. Task **ids are deterministic** (for example `feed:<planting>:<bucket>`), so Done, Skip, Snooze, "next gardening day" and "Not relevant" still apply after the tasks are regenerated. `planWeek()` keeps time-critical jobs on their day, always shows important jobs, fills the weekly budget with the rest, offers an "if you only have one hour" list, and moves everything else to *Can wait*. Nothing is ever shown as overdue.

### Companions and systems
Every companion relationship lists its **reasons** (support, shade, pollinators, shared pests…) and an **evidence level**: *established*, *plausible* or *traditional*. Folklore is labelled as traditional. Relationships can target a whole category, such as "pollinator plants help cucurbits".

Planting systems are data: members, roles, functions, and sequencing rules such as "after the support, 14–21 days, *when the corn is about 15 cm tall*". The planner checks each step against the member's window. Three Sisters is the first system. Guilds, rotations and pollinator strips can be added as more data.

### Rotation and space
Crop families come from the plant records. Growing the same family in the same area within a year triggers a warning. Space uses footprint ≈ plant spacing × row spacing, or mature width² for sprawling crops, with a 10 % tolerance. The checks cover overcrowding, "4 zucchini in a 1 × 1 m bed", sun hours, and minimum pot volume.

## Several gardens

`GardenData` holds one home garden (the Garden Profile's location and property) plus any extra `gardens`. Areas, plantings, journal notes, succession plans and observations carry an optional `gardenId`; no id means home. `settings.activeGardenId` picks the garden on screen. `useGardenView()` passes the engine a copy of the data **scoped to the active garden** (`scopeToGarden()` in `domain/gardens.ts`) with that garden's location, so every recommendation, task and forecast follows the garden being shown. New records are stamped with the active garden in the store. The wish list, your own plants, task responses and settings are shared by all gardens. A garden can only be deleted when it's empty.

## Storage and resilience

See the README's *Storage behaviour* section. In short: records are stored and validated one at a time, bad records are quarantined, writes are queued one after another, and restore swaps in a new generation atomically.

## Notifications and background execution

- `planReminders()` groups non-urgent jobs into **one message per gardening day** (or a daily or weekly summary), respects quiet days, and sends time-critical frost and heat warnings separately.
- `useReminderSync()` reschedules OS notifications (`expo-notifications`, DATE triggers) whenever tasks or preferences change, and the store refreshes on app foreground.
- **Closed-app weather alerts (Android, opt-in):** `services/alerts/backgroundAlerts.ts` registers an `expo-background-task` (about every 3 hours, when Android allows). It loads the saved garden, fetches each garden's forecast, and `weatherAlerts()` (`domain/alerts.ts`) turns frost, extreme heat or heavy rain today or tomorrow into notifications. Each alert has a key (`<garden>:<kind>:<date>`) so it's sent only once. The task is defined in `index.ts` so Android can run it without opening the app.
- **Limitation, stated plainly:** iOS and Android don't guarantee background execution. Scheduled reminders reflect the garden and forecast as they were **when the app was last opened**, and closed-app alerts run when Android chooses (battery saving can delay them). The app says this on the Reminders screen. iOS limits apps to 64 pending notifications; the app schedules at most 30. Notifications aren't available in the browser.
- There is deliberately **no push server**.

## Home-screen widget (Android)

`react-native-android-widget` renders `src/widget/ThisWeekWidget.tsx`. The app builds a small snapshot of the active garden (top jobs, today's weather, what's good to plant) with `buildWidgetSnapshot()` whenever the garden changes, and saves it under `sbs:widget:snapshot`. The widget task handler (`widgetTaskHandler.tsx`, registered in `index.ts`) draws from that snapshot, so the widget never needs the full engine or the network.

## Browser version

The same code is exported for the web (react-native-web) and served from `/sow-by-season/` on GitHub Pages. `scripts/prepare-web.mjs` adds a web app manifest (so it can be added to a home screen, including on iPhone) and a small service worker: the app page is fetched fresh when online and cached for offline use, and the other built files are cached. Garden data is never in that cache. GitHub Pages has no server-side routing, so the site's `404.html` sends addresses inside the app back to `/sow-by-season/?to=<path>`, and the app's layout opens that path. The garden map is a Leaflet map in an Expo DOM component, so it works in the browser and on Android.

## Plant list updates, update notices and plant sharing

- **Plant list:** the built-in catalogue can be replaced by a newer `catalogue.json` from the private plant data repository, downloaded at most daily with a read-only token. It's treated as untrusted: validated plant by plant, never older than the built-in list, and cached for offline use (`services/catalogue/catalogueUpdates.ts`, `domain/catalogueUpdate.ts`).
- **Update notices:** each Android release writes `app-version.json` to the same repository. The app reads it daily or weekly (the gardener's choice) — at start-up, on returning to the app, and from a background task (`services/updates/updateTask.ts`) that shows a local notification once per new version. Tapping it opens the release. Only links to this project's own releases are accepted (`services/updates/appUpdates.ts`). There's deliberately no push service: that would need a server holding a list of every phone.
- **Plant sharing:** opt-in per plant; sends only plant details, notes and climate zone as an issue in that repository (`services/plants/plantSuggestions.ts`). A daily workflow does first checks; a person verifies before anything is added to the plant list.

## Designed-for extensions

- **IoT sensors:** `Observation { kind, value, unit, at, source: 'sensor', deviceId, areaId?, plantingId? }` is already in the data model, the validation and the backups. A sensor service would write observations, and the engine could then prefer *measured* soil temperature (`soilTempKind: 'measured'` is already supported) over the modelled value.
- **Plant layout within beds:** areas have dimensions (and optional map outlines) and plants have spacing and mature size, so positions can be added to plantings without changing the engine.
- **Shared households:** several gardens already live in one data set; sharing one between people would need a sync service, which the local-first design deliberately avoids for now.
- **SQLite:** if the data grows (sensor data), swap `KeyValueStore` for an SQLite-backed repository. The domain doesn't change. Photos are already stored as files, outside AsyncStorage.

## Accessibility

- Status is always shown as an **icon plus words** (badges, reasons) and never by colour alone.
- Touch targets are at least 48 px. Text uses system font scaling.
- Pressables have an accessibility role, label and state (checked/selected/disabled). Steppers are `adjustable` and support increment/decrement actions.
- Colour tokens meet **WCAG AA** in both light and dark themes (checked with a contrast script: every text/background pair is ≥ 4.5:1).
- The glossary uses contextual "?" tips instead of long essays.
