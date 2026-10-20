---
id: "keyboard-focus-fallback-can-outlive-live-theme"
kind: "finding"
title: "Keyboard focus fallback can outlive the live theme"
status: "proposed"
tags: ["accessibility", "focus", "theme", "web"]
created_at: "2026-08-14T15:46:17.785Z"
updated_at: "2026-08-14T15:47:27.557Z"
---

# Keyboard focus fallback can outlive the live theme

<!-- compiled_truth -->

The global `*:focus-visible` CSS fallback in packages/app/public/index.html hard-codes Daylight gold and Twilight blue based only on system color scheme. Some React Native Web controls do not replace that outline with a live theme-owned focus style, so a non-Twilight dark theme can retain Twilight blue keyboard focus styling after mount.

## Timeline

- time: "2026-08-14T15:46:17.785Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T15:46:17.785Z"
  kind: "evidence"
  summary: "Code inspection on 2026-08-14: packages/app/public/index.html applies `#5aa0ee` for every dark `prefers-color-scheme`; packages/app/src/styles/theme.ts defines this as Twilight’s accent. packages/app/src/components/ui/button.tsx does not consume the shared control interaction styles, unlike form/select fields."
- time: "2026-08-14T15:47:27.557Z"
  kind: "evidence"
  summary: "Addressed on 2026-08-14 by changing the global focus rule to `var(--colors-accent, #c69700)` and removing the universal dark-mode Twilight-blue override. Daylight now resolves the fallback to its yellow accent after Unistyles applies the active theme."
  source: "packages/app/public/index.html"
