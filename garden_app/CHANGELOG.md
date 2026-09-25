# Changelog — Sow by Season

Releases are on the [GitHub releases page](https://github.com/BearyNatural/claude/releases) (tags `garden_app-v<version>-build<n>`). The newest Android version can always be downloaded from https://daydreaminginthecloud.bearynatural.dev/sow-by-season/android.html.

## 1.9.0 — 25 September 2026
- **New-version notifications**: the app now also checks for updates in the background and when you return to it (not only on a fresh start), and shows a notification once per new version. Tap it to download.
- **Garden Profile › General › Check for new versions**: once a day (default) or once a week, plus **Check now**.

## 1.8.0 — 25 September 2026
- **Location search understands what you type**: "Bray Park Qld", "Bray Park, QLD 4500" or a full street address now find the suburb (only the suburb is kept). Online search sends just the place name.
- Setting your area manually uses the full postcode list, so postcodes like 4500 get their climate from the nearest reference town instead of a "couldn't find" guess.
- **Garden Profile › General**: choose whether backups include photos, and whether plants you add start with "Share" ticked (off unless you turn it on — sharing is now truly opt-in).
- The photo choices on the Backup screen are always shown, even before you've added photos.
- Adding your own plant no longer pre-selects lifecycle, start method, sun or support — each starts as "Not sure". Backup schema v7.
- If sharing a plant fails, its page now says why instead of always "waiting to be online".
- Button and text fix for Android phones that cut off the last word of bold text (e.g. "Turn weather off").
- Docs: the plant data token's permissions are described exactly; `.nvmrc` for Node 22.

## 1.7.1 — 25 September 2026
- **Android download page** that always fetches the latest APK, linked from the Hobbies page and the browser version's More screen.
- The browser's offline copy now only stores the real app page (it could keep the site's redirect page instead).
- Privacy & your data now covers update checks, closed-app alerts, automatic backup and browsers clearing data.
- Documentation brought up to date (README, architecture, decision records 0009–0010, this changelog).

## 1.7.0 — 25 September 2026
- **More than one garden** (More › Gardens): each has its own location, weather, areas, plantings and notes, with a switcher on This Week, My Garden and More. Backup schema v6.
- **Weather alerts when the app is closed** (Android, opt-in in Reminders): frost, extreme heat and heavy rain today or tomorrow.
- Browser version moved to **`/sow-by-season/`**; old `/garden/` links forward there. The Gardens and garden map pages now open correctly in the browser.

## 1.6.0 — 25 September 2026
- **Browser version** (works on computers, and on iPhone via Add to Home Screen), with offline support.
- **Android home-screen widget**: this week's top jobs, today's weather and what to plant now.
- **Automatic backup** to a folder you choose (e.g. Google Drive or OneDrive).
- **"New version available"** notice with a Download button.
- **Opt-in plant sharing**: plants you add can be suggested for the shared plant list (plant details only, verified before being added).
- Garden photo banner; wider layout on large screens.

## 1.5.x — 25 September 2026
- **Add a plant that isn't listed**, with optional botanical-name lookup (Atlas of Living Australia). Backup schema v5.
- **Plant list updates between releases** from a private repository, read with a read-only token; weekly token-expiry check.

## 1.4.0 — 25 September 2026
- **Plant photos**, stored on the device; optionally included in backups. Backup schema v4.

## 1.3.0 — 25 September 2026
- More fruit: avocado, grape, dragon fruit, mulberry, peachcot, plumcot, plum, peach, nectarine, apricot, apple and pear.

## 1.2.x — 25 September 2026
- **Optional garden map**: find your address on satellite imagery (Esri), outline beds and get their size.
- 1.2.1: address search works on phones (Photon first); outlining an existing bed updates it instead of creating a duplicate, and beds can be merged.

## 1.1.0 — 25 September 2026
- **Every Australian postcode and suburb** built in (GeoNames), so location search works offline.
- Live weather fixed, including Try again.
- Pots and pot areas when adding a planting; change a planting's area after saving; **one planting in several areas**. Backup schema v3.

## 1.0.x — 24 September 2026
- First release: Plant Now, This Week, plantings and timelines, succession planting, Three Sisters, seasonal calendar, wish list, reminders, backup and restore. See the [development report](DEVELOPMENT_REPORT.md).
- 1.0.1: weekly dependency update.
