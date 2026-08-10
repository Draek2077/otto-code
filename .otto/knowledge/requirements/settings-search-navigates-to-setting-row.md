---
id: "settings-search-navigates-to-setting-row"
kind: "requirement"
title: "Settings search navigates to the canonical setting row"
status: "confirmed"
tags: ["settings", "search", "navigation", "user-mode", "developer-mode", "host-settings"]
created_at: "2026-08-10T01:10:28.797Z"
updated_at: "2026-08-10T01:10:28.797Z"
---

# Settings search navigates to the canonical setting row

<!-- compiled_truth -->

Settings search is a navigation tool, not a separate editing form. Each result shows the setting name, short description, scope (App, Desktop, or Host), category, audience, and Advanced status. Selecting a result navigates to the canonical Settings section, selects the correct Host when Host-owned, reveals the setting when it is inside an Advanced group, scrolls to the exact row, and briefly highlights it. The user edits the setting through its normal control. Hidden Developer settings remain searchable and explain that Developer mode must be enabled before editing. If a Host setting is unavailable because its Host is disconnected, the result reports that state. Search must not expose secret values or create a duplicate editing path.

## Timeline

- time: "2026-08-10T01:10:28.797Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["settings-catalog-search-and-scope"]
- time: "2026-08-10T01:10:28.797Z"
  kind: "evidence"
  summary: "User explicitly approved this interaction design on 2026-08-09: search should find, navigate, reveal, highlight, and edit the canonical setting row in place."
