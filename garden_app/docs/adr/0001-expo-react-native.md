# 0001 — Expo + React Native + TypeScript

**Status:** accepted · 2026-09-24

**Context.** The app has to run on Android and iPhone, ideally with a browser preview, and should be commercially maintainable by a small team.

**Decision.** Use Expo SDK 57 (React Native 0.86), TypeScript in strict mode, and expo-router for file-based navigation. Use Expo modules for notifications, files, sharing and document picking.

**Consequences.** One codebase covers iOS, Android and web. EAS handles builds and store submission. Native modules are limited to well-maintained Expo packages. The web preview uses react-native-web, and some native features (local notifications, the share sheet) degrade on web.
