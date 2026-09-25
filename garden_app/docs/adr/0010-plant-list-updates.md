# 0010 — Plant list updates from a private repository

**Status:** accepted · 2026-09-25

**Context.** Plant data improves more often than the app is released, and new plants (for example fruit trees) shouldn't need a new APK. There is no BearyNatural server, and the plant data repository should stay private.

**Decision.** A workflow publishes `catalogue.json` (and, per Android release, `app-version.json`) to the private repository `BearyNatural/australian_plant_data` with a write deploy key. The Android build embeds a **fine-grained token for that repository only**, with Contents read-only and Issues read/write (for sharing) (from the `PLANT_DATA_READ_TOKEN` secret). The app downloads the list at most daily through the GitHub API and treats it as untrusted: every plant is validated, a list older than the built-in one is ignored, and the last good list is cached. Gardeners can add their own plants, and can opt in to share them (plant details only) as issues in that repository; a person verifies every suggestion before it's added. A weekly workflow warns before the token expires.

**Consequences.** Plant updates reach phones without a release. Anyone who unpacks the APK could extract the token, which exposes only the plant data and shared suggestions (plant details only), and lets them file or edit suggestions; nothing reaches the plant list without a person verifying it. Tokens expire and must be renewed by hand; without a token the app simply keeps its built-in list. The browser version gets plant updates when the website is rebuilt, and has no token.
