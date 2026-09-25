# 0001 — Expo + React Native + TypeScript

**Status:** accepted · 2026-09-24

**Context.** The app has to run on Android and iPhone, ideally with a browser preview, and should be commercially maintainable by a small team.

**Decision.** Use Expo SDK 57 (React Native 0.86), TypeScript in strict mode, and expo-router for file-based navigation. Use Expo modules for notifications, files, sharing and document picking.

**Consequences.** One codebase covers iOS, Android and web. Android releases are built by GitHub Actions (EAS remains an option for store builds). Native modules are limited to well-maintained packages. The browser version uses react-native-web, and some native features (notifications, the widget, background tasks, automatic backup) are Android-only (see ADR 0009).
