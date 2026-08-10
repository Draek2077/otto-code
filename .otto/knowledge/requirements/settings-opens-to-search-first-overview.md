---
id: "settings-opens-to-search-first-overview"
kind: "requirement"
title: "Settings opens to a search-first overview"
status: "confirmed"
tags: ["settings", "search", "navigation", "information-architecture", "app", "host"]
created_at: "2026-08-10T01:12:09.066Z"
updated_at: "2026-08-10T01:12:09.066Z"
---

# Settings opens to a search-first overview

<!-- compiled_truth -->

Opening Settings lands on a dedicated search-first Settings overview instead of directly opening App → General. The overview places the Settings search field first and makes it the primary action. Search covers App, Desktop, and Host settings, with scope and Host context represented in grouped result rows. When no query is entered, the overview may show curated common settings or recent settings, but it must remain a search-first landing surface. General remains a normal App settings subsection accessible from the sidebar and direct routes. Selecting a result uses the canonical setting row flow: choose the correct scope and Host, reveal Advanced content when necessary, scroll to the setting, highlight it, and allow in-place editing.

## Timeline

- time: "2026-08-10T01:12:09.066Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["settings-search-navigates-to-setting-row","settings-search-follows-history-ui-patterns"]
- time: "2026-08-10T01:12:09.066Z"
  kind: "evidence"
  summary: "User explicitly requested on 2026-08-09 that Settings open to search first rather than App → General, so searching and selecting a result is the first interaction."
