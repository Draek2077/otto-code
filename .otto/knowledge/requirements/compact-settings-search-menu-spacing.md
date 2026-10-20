---
id: "compact-settings-search-menu-spacing"
kind: "requirement"
title: "Compact settings search leads directly to the settings menu"
status: "confirmed"
tags: ["settings", "mobile", "ui", "layout"]
created_at: "2026-08-11T03:51:20.788Z"
updated_at: "2026-08-11T03:55:07.347Z"
---

# Compact settings search leads directly to the settings menu

<!-- compiled_truth -->

On compact/mobile settings root, the settings section menu must directly follow a standalone “Search settings...” field with normal page spacing. The root must not display introductory heading or instructional copy, nor a redundant browse call-to-action or large visual gap before the menu.

## Timeline

- time: "2026-08-11T03:51:20.788Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T03:51:20.788Z"
  kind: "evidence"
  summary: "User-reported mobile settings UI bug with screenshot on 2026-08-10. Implemented in packages/app/src/screens/settings-screen.tsx."
- time: "2026-08-11T03:55:07.347Z"
  kind: "decision"
  summary: "User explicitly requested a standalone search field without the “Find a setting” heading or instructional copy on 2026-08-10."
  source: "User request in chat on 2026-08-10."
