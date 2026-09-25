# 0009 — Browser version on GitHub Pages

**Status:** accepted · 2026-09-25

**Context.** iPhone users can't install the Android APK, and publishing to the App Store needs a paid Apple Developer account. People also want to use the app on a computer. The app must stay local-first with no BearyNatural server.

**Decision.** Export the same Expo code for the web and publish it as static files to `/sow-by-season/` on the personal site (GitHub Pages), from `ci/garden_app-web.yml` using a deploy key for that repository only. Add a web app manifest and a small service worker so it can be added to a home screen and opened offline. Deep links go through the site's `404.html`, which sends them back to the app with `?to=<path>`. The base path must not be a prefix of any screen name, because expo-router strips it from the start of every address (the first choice, `/garden`, broke `/gardens` and `/garden-map`).

**Consequences.** Free hosting, no server, and one codebase. Browser data is stored per browser and can be cleared by the browser, so the app and docs push backups to the gardener's own cloud storage. Features that need the phone (reminders, closed-app alerts, the widget, automatic backup, plant sharing) are Android-only and say so.
