# Sow by Season — by BearyNatural

*Know what to plant. Know when to plant it.*

Sow by Season is a garden-planning app for Australian gardeners. It helps you answer four questions:

1. **What can I plant now?** Suggestions for your climate zone, the season, the local forecast and your garden, each with the reasons behind it.
2. **What should I do this week?** Jobs worked out from what you're actually growing, sized to the time you have.
3. **What is happening in my garden?** Your plantings, their estimated growth stages, and a timeline of expected flowering and harvest that updates as you record what really happens.
4. **What should I plant next?** Seasonal and succession-planting plans, your wish list, and structured systems such as Three Sisters.

It runs as an **Android app** and in any **web browser** (which also works on iPhone — see below). It is **local-first**: there's no account, BearyNatural keeps no server copy of your garden, and your garden and any personal details stay on your own device.

| This Week | Plant Now | Planting timeline | Plant detail |
|---|---|---|---|
| ![This Week](docs/screenshots/this-week.png) | ![Plant Now](docs/screenshots/plant-now.png) | ![Timeline](docs/screenshots/planting-timeline.png) | ![Plant](docs/screenshots/plant-detail.png) |

> **About these screenshots:** they show version 1.0 with a demo garden and mocked weather. The current app looks much the same, with some additions (the garden photo banner, the garden switcher, maps and photos).

---

## Getting the app

| Where | How |
|---|---|
| **Android** | Download from **https://daydreaminginthecloud.bearynatural.dev/sow-by-season/android.html** — it always gets the latest version (also linked from the Hobbies page and the browser version's More screen) — or from the latest release (steps below). Includes reminders, the home-screen widget, automatic cloud backup and update notices. |
| **Any browser** | Open **https://daydreaminginthecloud.bearynatural.dev/sow-by-season/** (also linked from the Hobbies page). Works on computers, tablets and phones, and keeps working offline once opened. |
| **iPhone / iPad** | Open that address in **Safari**, tap **Share → Add to Home Screen**. It opens like an app — no App Store or Apple account needed. (Phone reminders and the widget aren't available on iPhone.) |

### Your garden stays on your device — keep a backup in your own cloud storage

Everything you enter (your garden, plantings, photos, notes, address if you use the garden map) is stored **only on the device or browser you're using**. BearyNatural never receives it. That's private, but it also means the phone app and the browser each have **their own copy** — they don't sync by themselves.

To protect your garden, and to use the same garden in both places, **back it up to your own cloud storage** (Google Drive, OneDrive, iCloud Drive or Dropbox):

- **Android app — automatic:** More › **Backup & restore** › **Choose a backup folder**, and pick a folder in Google Drive or OneDrive. The app then keeps `SowBySeason-AutoBackup.json` up to date whenever your garden changes. You can include or leave out photos.
- **Browser (and iPhone):** More › **Backup & restore** › **Back up now**, then save the file to your cloud storage. (Browsers can't save to cloud storage by themselves.)
- **To move your garden** to a new phone or into the browser: More › **Backup & restore** › **Choose backup file**, and pick your latest backup from cloud storage. Restoring replaces what's on that device.

### Updates

- **Android:** when a new version is released, the app shows **"Sow by Season x.y is available — Download"** on the This Week screen. Tap it, download the file and tap **Install**. Your garden is kept. (Android always asks you to confirm installs from outside the Play Store — the app can't update itself silently.)
- **Browser:** always up to date — just reload the page.
- **Plant information** (new plants and corrections) updates on its own between versions: about daily in the Android app, and whenever the website is updated in the browser.

### More than one garden

Keep separate gardens — for example home, a community garden plot or a relative's place — under **More › Gardens**. Each garden has its own location, weather, areas, plantings and notes; switch between them with the garden name at the top of This Week, My Garden and More. Your wish list, your own plants and your settings are shared. All gardens are in the same backup.

### Weather alerts when the app is closed (Android)

Turn on **Reminders › Weather alerts when the app is closed**. A few times a day, when the phone allows, the app checks each garden's forecast and sends a notification about **frost, extreme heat or heavy rain today or tomorrow** — each warning once. Android decides exactly when these checks run (battery saving can delay them), so they're a helpful extra, not a guarantee. Only rounded coordinates are sent to the weather service, as when the app is open. Not available in the browser.

### Home-screen widget (Android)

Long-press your home screen › **Widgets** › **Sow by Season**. The widget shows this week's most important jobs, today's weather and what's good to plant now; tap it to open the app. It refreshes when you open the app and about every half hour.

### Plants you add, and the shared plant list

If a plant isn't in the list, add it with **"Add a plant that isn't listed"**. When adding a plant you can choose **"Share this plant to help grow the plant list"** (off unless you tick it; to have it ticked for every new plant, choose **Share them** under **Garden Profile › General**). Shared plants are used to expand the Sow by Season plant list for everyone:

- **Only plant information is shared** — the plant's name, type, planting months, sun/frost/pot details, your notes about it, and your climate zone (e.g. "subtropical"). **Never photos**, your location, address, garden, name or anything personal. Please keep personal details out of plant notes.
- Nothing is added automatically: every shared plant is checked, and its growing details are **verified against reliable Australian sources** before it's added to the plant list.
- Sharing needs the Android app; the browser version can't share.

## Install on an Android phone

1. On your phone, open **https://daydreaminginthecloud.bearynatural.dev/sow-by-season/android.html**. The latest version starts downloading. (Or open the repository's **Releases** page — GitHub → BearyNatural/claude → Releases — and tap the **`SowBySeason-….apk`** file in the newest **Sow by Season** release.)
2. Open the downloaded file from the notification or your Files/Downloads app.
3. If asked, allow your browser or Files app to **install unknown apps**, then tap **Install**.
4. To update later, install the newest release over the top. Your garden data is kept, as long as the signing secrets described below are set up.

New releases are built automatically by GitHub Actions whenever app code in `garden_app/` changes on `main`, or when you choose **Actions → garden_app · Android build & release → Run workflow**. Releases are tagged `garden_app-v<version>-build<n>`. Changes to documentation alone don't start a build.

### Automated workflows

The workflows live in `ci/` and are copied to `.github/workflows/` by `publish-to-github.sh`:

| Workflow | When | What it does |
|---|---|---|
| `garden_app-android.yml` · *Android build & release* | App code changes on `main` | Tests, builds and signs the APK, publishes a GitHub release, and updates `app-version.json` (the "new version available" notice) |
| `garden_app-web.yml` · *publish browser version* | App code changes on `main` | Builds the browser version and publishes it to `/sow-by-season/` on the personal site (`BearyNatural/BearyNatural.github.io`, `SITE_DEPLOY_KEY`) |
| `garden_app-plant-data.yml` · *publish plant list* | Plant data changes on `main` | Publishes `catalogue.json` for plant list updates (see [Plant list updates](#plant-list-updates)) |
| `garden_app-plant-suggestions.yml` · *check plant suggestions* | Daily | First checks on plants shared from the app (see [Shared plant suggestions](#shared-plant-suggestions)) |
| `garden_app-token-check.yml` · *plant list token check* | Weekly | Warns before the plant data token expires |

**Release notes come from [`CHANGELOG.md`](CHANGELOG.md).** When you change the version in `app.json`, add a `## <version> — <date>` section at the top of the changelog; the Android build copies that section into the GitHub release. Weekly dependency updates without a section get "Dependency updates and maintenance".

Every week the repository's **Weekly maintenance** workflow also scans this project (secrets, static analysis, vulnerable or badly-licensed dependencies, tests, type-check), updates dependencies to the newest Expo-compatible versions and, if tests still pass, bumps the patch version and publishes a new release. Problems are flagged in the run summary and in a GitHub issue named *Weekly maintenance: garden_app*.

There's no native iPhone app (that needs an Apple Developer account); iPhone users use the browser version added to the home screen, as above.

## Contents

- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Setup and running](#setup-and-running)
- [Tests](#tests)
- [Building for devices](#building-for-devices)
- [External services](#external-services)
- [Environment variables](#environment-variables)
- [Storage behaviour](#storage-behaviour)
- [Privacy model](#privacy-model)
- [Backup format](#backup-format)
- [Horticultural data and its limits](#horticultural-data-and-its-limits)
- [Known limitations](#known-limitations)
- [Future development](#future-development)

More documents:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit together, and the gardening engine in detail
- [`docs/adr/`](docs/adr/): architecture decision records
- [`docs/DATA_REVIEW.md`](docs/DATA_REVIEW.md): the plant data that needs horticultural review
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version
- [`DEVELOPMENT_REPORT.md`](DEVELOPMENT_REPORT.md): the original 1.0 build report

---

## Technology stack

| Concern | Choice |
|---|---|
| App framework | **Expo SDK 57** (React Native 0.86, React 19.2) with **TypeScript** |
| Navigation | **expo-router** (file-based: `app/`) |
| State | A small dependency-free observable store (`src/state/gardenStore.ts`) read through `useSyncExternalStore` |
| Local storage | `@react-native-async-storage/async-storage` behind a `KeyValueStore` interface, with one record per key |
| Weather | [Open-Meteo](https://open-meteo.com) forecast API. No key is needed for non-commercial use |
| Place search | Every Australian postcode and suburb built in (GeoNames, offline); Open-Meteo geocoding as an optional extra |
| Garden map (optional) | Leaflet in an Expo DOM component, Esri World Imagery, Photon / Nominatim address search |
| Photos | `expo-image-picker`, stored as files (IndexedDB in the browser) |
| Notifications | `expo-notifications`, **local only**; closed-app weather checks with `expo-background-task` (Android) |
| Home-screen widget | `react-native-android-widget` (Android) |
| Backup files | `expo-file-system` (including an Android folder for automatic backup), `expo-sharing`, `expo-document-picker` (the phone's own file providers) |
| Browser version | Expo web export (react-native-web) plus a web app manifest and a small offline service worker (`scripts/prepare-web.mjs`), hosted on GitHub Pages |
| Tests | Node's built-in test runner via `tsx`. The domain has no dependencies, so the tests need no emulator |

## Architecture

```
index.ts                App entry: registers the Android widget and the closed-app weather check, then starts expo-router
app/                    Screens (expo-router). Thin: they read state and call actions.
  (tabs)/               This Week · Plant Now · My Garden · Plants · More
  plant/[id], plant/custom  Plant detail (sources, windows, companions, soil advice…); add your own plant
  planting/new, [id]    Add a planting; timeline, events, journal, stage, photos
  area/…                Garden areas
  garden-map            Optional satellite map: outline beds and measure them
  gardens               More than one garden
  succession/…          Succession plans
  three-sisters, calendar, wishlist, journal, profile, reminders, backup, privacy, glossary, about
public/android.html     Browser download page that fetches the latest APK
src/
  domain/               PURE TypeScript gardening engine — no React, no I/O
    types.ts, plantTypes.ts        data model
    dates.ts, climate.ts, location.ts, windows.ts
    catalogue.ts                   validation + natural-language search
    weather.ts                     freshness (fresh/stale/unavailable) + assessment
    recommend.ts                   "What can I plant now?"
    production.ts                  household quantity model
    succession.ts                  succession plans + accept/postpone/skip/resize/stop
    companions.ts, systems.ts      companion logic; planting systems (Three Sisters)
    rotation.ts, space.ts          crop-family rotation; spacing/overcrowding/sun/pot checks
    timeline.ts                    estimated milestones, replaced by real observations
    tasks.ts, workload.ts          weekly jobs + time-aware prioritisation
    reminders.ts, alerts.ts        consolidated reminder planning; closed-app weather alerts
    calendar.ts                    seasonal calendar data
    gardens.ts                     several gardens: the active garden and what belongs to it
    plantValidation.ts, catalogueUpdate.ts   checking downloaded plant lists and your own plants
    validation.ts                  runtime validation for every stored record
    backup/                        versioned format, migrations, safe restore
  data/                 Plant catalogue, sources registry, localities, companions, systems, glossary
  services/             I/O adapters: storage, weather, location and address search, notifications,
                        background alerts, backup files (manual and automatic), photos, plant list
                        updates, app update notices, plant sharing. `*.web.ts` files are the browser versions
  state/                Store (actions = domain + persistence), React hooks, automatic backup
  ui/                   Theme tokens, accessible components, shared forms, map
  widget/               Android home-screen widget
tests/                  217 automated tests in 16 files
data-sources/           Raw captures of source data (Gardening Australia monthly lists)
scripts/                Data build scripts, the browser build finisher, the plant suggestion checker
web/                    Browser app icons
ci/                     GitHub Actions workflows for this project
docs/                   Architecture, ADRs, data review, screenshots
```

**Rule of thumb:** the gardening rules live in `src/domain`, not in screens. Plant-specific behaviour lives in the catalogue data: windows, production profiles, tolerances, companions and systems. The engine reads that data. It never uses `if (plant === 'carrot')`.

## Setup and running

Requirements: **Node 22.13+** (`.nvmrc`: run `nvm use`), npm, and for devices the **Expo Go** app or a development build.

```bash
cd garden_app
bash scripts/ci-install.sh # installs Expo, then lets Expo pick compatible versions of everything else
# (or: npm install && npx expo install --fix)
npm start                  # then press a (Android), i (iOS simulator) or w (web)
```

Other commands:

```bash
npm run web          # browser development preview
npm run android      # open on a connected Android device / emulator
npm run ios          # open in the iOS simulator (macOS)
npm test             # run all automated tests (no emulator needed)
npm run typecheck    # full TypeScript check (needs node_modules installed)
npm run typecheck:domain  # type-check the engine only (works without node_modules)
npm run data:ga-windows   # rebuild planting windows from data-sources/
npm run doctor       # expo-doctor dependency health check
```

To build the browser version as it's published:

```bash
npx expo export --platform web --output-dir dist
node scripts/prepare-web.mjs dist /sow-by-season   # manifest, icons, offline cache
```

The app expects to be served from `/sow-by-season/` (`experiments.baseUrl` in `app.json` and `src/services/webBase.ts`). To move it, change both and the path in `ci/garden_app-web.yml`. Don't use a path that any screen name starts with (such as `/garden`): expo-router strips it from the start of every address.

## Tests

```bash
npm test
```

There are **217 tests in 16 files, and all pass.** They cover Australian season boundaries, timezones and daylight saving, gardens that run across the new year, per-zone recommendations (Brisbane, Hobart, Darwin, Perth, inland Queensland), stale and unavailable weather, modelled soil temperature, frost, heat and heavy rain, household scaling, single-harvest vs repeat-harvest crops, succession limits at the end of the season, succession actions, Three Sisters sequencing, companion evidence levels, overcrowding, rotation, timelines, task generation and prioritisation, available gardening time, reminders, backup, restore, corrupt backups, schema migrations, atomic restore, per-record storage resilience, the weather client and cache, catalogue validation, one integrated scenario taken from the brief, and — added since 1.0 — postcode search, plantings in several areas, the garden map and outline merging, photos and photo backups, plant list updates and your own plants, update notices and plant sharing, several gardens, closed-app weather alerts and the widget. The original test plan is in the [development report](DEVELOPMENT_REPORT.md#testing).

## Building for devices

Releases are built by `ci/garden_app-android.yml` without EAS: `expo prebuild` generates the Android project, and Gradle builds and signs the APK with the upload key from the repository's Actions secrets (the key itself lives in `_private_signing/` on your computer, never in git). To build locally:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

EAS (`eas build --platform android|ios`) also works if you prefer Expo's build service; iOS needs an Apple Developer account.

The package name is set in `app.json` (`au.com.bearynatural.sowbyseason`). The only Android permission the app asks for is **notifications**. Location permissions are explicitly **blocked**, because the app never uses GPS.

## External services

| Service | Used for | Sent | Required? |
|---|---|---|---|
| Open-Meteo forecast (`api.open-meteo.com`) | 7-day forecast, frost/heat/rain checks, **modelled** soil temperature | Rounded coordinates (~1 km) and timezone | No. The app falls back to seasonal advice |
| Open-Meteo geocoding (`geocoding-api.open-meteo.com`) | "Search more places online" during location setup | The search text | No. Every postcode and suburb is also in the app (GeoNames, offline) |
| Photon by Komoot / OpenStreetMap Nominatim | Optional garden map: finding a street address | The address typed, when "Find address" is pressed | No. The map can start from the suburb instead |
| Esri World Imagery | Optional garden map: satellite images | Map tile requests for the area on screen | No |
| Atlas of Living Australia species search (`api.ala.org.au`) | Optional botanical-name lookup for plants you add | The name typed, when "Look up" is pressed | No |
| GitHub API (`api.github.com`) — reading | Android: plant list updates between releases (about daily; can be turned off in About) and the "new version available" check (at most daily) | Nothing about the garden — file downloads using the app's read-only token | No. The built-in plant list is used offline or without a token |
| GitHub API — plant sharing | Plants you choose to share, as an issue in the private plant data repository | The plant's details, your notes about it and your climate zone | No. Sharing is opt-in per plant, Android only |
| GitHub Pages | Hosting the browser version and its Android download page (which looks up the latest release on the GitHub API) | Normal web requests | Only for the browser version |

There is no BearyNatural server, analytics, advertising or push-notification service.

**Commercial use:** Open-Meteo's free API is for non-commercial use. A commercial release needs an Open-Meteo API subscription. Set `EXPO_PUBLIC_OPEN_METEO_API_KEY` and the client switches to the customer endpoint automatically.

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_OPEN_METEO_API_KEY` | Optional. Open-Meteo customer API key for commercial use. |
| `EXPO_PUBLIC_PLANT_DATA_TOKEN` | Optional. The plant data token (read the plant list; file plant suggestions). Set by the Android build from the `PLANT_DATA_READ_TOKEN` secret; leave it unset locally and in the browser build. Without it, plant list updates, update notices and plant sharing are switched off. |

`EXPO_PUBLIC_*` values are embedded in the app bundle, so don't put secrets there that must stay private.

## Storage behaviour

- **Everything the gardener creates is stored on the device** in AsyncStorage (localStorage on web), **one record per key**. The keys look like `sbs:g<generation>:<collection>:<id>`.
- **One corrupt record never takes the garden down.** Every record is validated when loaded. A record that fails is moved aside to a `sbs:quarantine:*` key (kept, not deleted), and the app tells the gardener.
- **Restore is atomic.** A complete new data "generation" is written and checked. Then a single key (`sbs:meta:generation`) is flipped to make it live. If anything fails before that flip, the partial generation is discarded and the current data stays untouched. Leftovers from an interrupted restore are cleaned up on the next launch.
- Weather is cached under `sbs:cache:weather` with its fetch time, so it can be shown honestly as stale when you're offline.
- **Photos** are files in the app's own storage (IndexedDB in the browser). Records keep only the file name.
- **Several gardens** share one data generation. Areas, plantings, journal notes, plans and observations carry a `gardenId` (none means the home garden).
- The plant catalogue is bundled with the app. A newer downloaded plant list is cached under `sbs:cache:*` for offline use. Neither is included in backups; your own plants are.
- Small helper keys: the widget's snapshot (`sbs:widget:snapshot`) and the alerts already sent (`sbs:alerts:sent`).
- **Browser storage can be cleared by the browser.** Safari in particular may delete a website's data if you haven't visited it for about a week, unless it's been added to the Home Screen. Back up to cloud storage.

## Privacy model

In plain language, as it appears on the in-app **Privacy & your data** screen:

- Your garden data is stored locally on your device (or in your browser, for the browser version). The phone app and the browser keep separate copies; move between them with a backup file in your own cloud storage.
- BearyNatural doesn't maintain an online garden account or database.
- **Plant sharing (optional, per plant):** plants you choose to share — plant details, your notes about them and your climate zone only; never photos or personal information — may be used to expand the Sow by Season plant list after being verified against reliable sources.
- **Optional garden map:** your street address and garden outlines stay on your device.
- **Photos** stay on your device and are only in backups if you choose.
- Your location is used only for climate and weather advice. It's approximate (suburb or postcode, rounded coordinates), and the app never asks for GPS or background location. Closed-app weather alerts (optional, Android) send the same rounded coordinates.
- Plant list updates and the "new version available" check download files from GitHub; nothing about your garden is sent.
- **Automatic backup (optional, Android)** writes your backup file to the folder you chose, such as Google Drive — your cloud storage, not BearyNatural's.
- Weather and place-search services receive the information they need to answer each request (approximate coordinates or search text, plus your IP address, as with any web request).
- Clearing the app's data or uninstalling can remove your garden records. Make backups if you want extra protection.
- You can delete everything from the device at any time.

## Backup format

A backup is a JSON file you save wherever your phone lets you: on the device, iCloud Drive, Google Drive, OneDrive, Dropbox, email, and so on. The app uses the operating system's share sheet and document picker, plus a "Save to folder…" option on Android. On Android, **automatic backup** keeps `SowBySeason-AutoBackup.json` up to date in a folder you choose (Storage Access Framework, with the folder permission kept). There's no custom cloud integration. Manual backups are named like `SowBySeason-Backup-2026-09-24.json`:

```json
{
  "format": "sow-by-season-backup",
  "schemaVersion": 7,
  "createdAt": "2026-09-25T08:00:00.000Z",
  "app": { "name": "Sow by Season", "version": "1.8.0" },
  "catalogueVersion": "2026.09.2",
  "counts": { "areas": 2, "plantings": 5, "journal": 2, "wishlist": 2, "successionPlans": 1, "taskResponses": 3, "observations": 0, "customPlants": 1, "gardens": 1 },
  "checksum": "fnv1a-1a2b3c4d",
  "data": {
    "profile": { … }, "settings": { … },
    "areas": [ … ], "plantings": [ … ], "journal": [ … ], "wishlist": [ … ],
    "successionPlans": [ … ], "taskResponses": [ … ], "observations": [ … ],
    "customPlants": [ … ], "gardens": [ … ]
  },
  "attachments": { "files": { "photo-….jpg": "<base64>" }, "checksum": "…" }
}
```

`attachments` is only there when you choose **Include photos**. Schema history: v2 one area per planting · v3 several areas · v4 photos, street address and bed outlines · v5 your own plants · v6 several gardens · v7 your own plants can leave lifecycle unknown (details in `src/domain/backup/migrations.ts`).

Restoring a backup goes through these steps:

1. Parse the file (damaged or truncated files are rejected).
2. Confirm it's a Sow by Season backup.
3. Check the schema version. Backups from newer versions are refused with an "update the app" message.
4. Verify the checksum.
5. Migrate older formats step by step (v1 → … → v7).
6. Validate every record. Unreadable records are listed and left out.
7. Show a preview and a clear "this will replace…" warning.
8. Replace the data atomically. Current data isn't touched until the new data is known to be good.

## Horticultural data and its limits

- **Planting windows** for about 38 crops come from **ABC Gardening Australia's Vegie Guide**. All five zones × 12 monthly lists were captured (`data-sources/gardening-australia/`) and converted by `scripts/build-ga-windows.mjs`. Gaps are filled only from other named sources (The Seed Collection chart, Sustainable Gardening Australia, NSW DPI, the Australian Blueberry Growers' Association), and each fill is noted on the record.
- **Spacing, germination days and days to maturity** come mainly from **The Seed Collection's** Australian sowing chart. **Germination soil temperatures** come from **Oregon State University Extension** (UC Davis data).
- **Unknown stays unknown.** For example, fig and mango have no recorded planting months, and rosemary has no sourced window. The app says so instead of guessing.
- **Household quantities, succession intervals, task minutes and weather thresholds are BearyNatural planning heuristics.** They're labelled as estimates everywhere.
- Heat tolerance, bolting thresholds, feeding intervals, amendments and common problems are mostly **general knowledge flagged for review**. [`docs/DATA_REVIEW.md`](docs/DATA_REVIEW.md) lists exactly what needs a horticulturist's eye.

### Plant list updates

The plant list built into the app can be updated between releases. When plant data changes on `main`, the **garden_app · publish plant list** workflow rebuilds `catalogue.json` (`scripts/build-catalogue-json.ts`) and pushes it to the **private** repository `BearyNatural/sow-by-season-plant-data`, using the `PLANT_DATA_DEPLOY_KEY` deploy key (write access to that repository only).

Installed apps download it at most once a day through the GitHub API, using a fine-grained token limited to that one repository, with **Contents: Read-only** (plant list and update notices) and **Issues: Read and write** (plant sharing). It can't change the plant list itself. The token comes from the `PLANT_DATA_READ_TOKEN` Actions secret and is embedded when the Android build runs (`EXPO_PUBLIC_PLANT_DATA_TOKEN`) — it is never in the source. Anyone who unpacks the APK could extract it: that exposes the plant list and the shared plant suggestions (which contain only plant details), and would let them file or edit suggestions — nothing that reaches other gardeners without a person checking it. Without the Issues permission, sharing simply doesn't send, and the plant page says why. Tokens expire: when it does, the app keeps its current list and About says updates need renewing — create a new token and replace the secret, and the next build carries it. Without the secret, builds simply skip plant list updates. They treat it as untrusted: every plant and source is validated (`src/domain/plantValidation.ts`, `src/domain/catalogueUpdate.ts`), invalid entries are dropped, and a list older than the one built into the app is ignored. The last good list is cached for offline use.

**When changing plant data, bump `CATALOGUE_VERSION`** in `src/data/plants/index.ts` (`YYYY.MM.N`).

Gardeners can also add their own plants ("Add a plant that isn't listed"). These are stored with their garden and included in backups.

### Shared plant suggestions

When a gardener shares a plant they added, the app opens an issue labelled `plant-suggestion` in `BearyNatural/sow-by-season-plant-data`, containing only the plant details, their notes and climate zone. This needs the read token to also have **Issues: Read and write** on that repository. Every day, *check plant suggestions* (`scripts/check-plant-suggestions.ts`) validates new suggestions, looks for duplicates of plants already in the list, confirms the botanical name with the Atlas of Living Australia, and comments with the result. It never changes the plant list: a person checks the growing details against reliable Australian sources and adds the plant to `src/data/plants/`, and *publish plant list* sends it to every app.

## Known limitations

- **Background execution isn't guaranteed.** Reminders are planned from the garden and forecast as they were when the app was last opened, and Android decides when closed-app weather checks and widget refreshes run (see `docs/ARCHITECTURE.md`).
- Climate zones are **5 broad zones** plus a frost-exposure setting. Microclimates need the manual override.
- Every Australian postcode and suburb can be found offline, but the climate zone and frost exposure are suggested from the nearest of about 155 reference towns. Check them, especially inland and at altitude.
- Arid-zone windows from Gardening Australia are very broad. The frost check reduces the risk, but arid advice is the least precise.
- The date input is a validated text field with ±1-week buttons. A native date picker is a planned improvement.
- The browser version has no reminders, closed-app alerts, widget, automatic backup or plant sharing, and browsers can clear its data (see *Storage behaviour*).
- The built-in plant list has 65 plants (more arrive with plant list updates); anything else can be added as your own plant.

## Future development

The architecture already has places for these: pest and disease identification, IoT sensors (the `Observation` records already support sensors tied to an area, planting, device and timestamp, and they're included in backups), weather stations, seed inventory and expiry, harvest weights (an `Observation` kind already exists), preserving reminders, seed saving, optional moon-planting as a labelled traditional system, more planting systems (guilds, rotations, pollinator strips), a fuller rotation planner and shared households. The original list of next steps is in the [development report](DEVELOPMENT_REPORT.md#recommended-next-work); items 4, 5 (background alerts) and 9 are done.

---

© BearyNatural. Weather data by Open-Meteo.com (CC BY 4.0).
