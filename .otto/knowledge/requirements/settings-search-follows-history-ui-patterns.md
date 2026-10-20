---
id: "settings-search-follows-history-ui-patterns"
kind: "requirement"
title: "Settings search follows History UI patterns"
status: "proposed"
tags: ["settings", "search", "history", "ui", "host-filter", "empty-states"]
created_at: "2026-08-10T01:11:02.382Z"
updated_at: "2026-08-10T01:11:02.382Z"
---

# Settings search follows History UI patterns

<!-- compiled_truth -->

Settings search should reuse the established History module interaction language where applicable: a compact control row, host-aware scope filtering, clear loading/error/empty states, consistent result-list rows, and predictable actions. Settings-specific behavior remains: selecting a result navigates to, reveals, scrolls to, and highlights the canonical setting row for in-place editing. The History module is a visual and state-handling reference, not a requirement to copy its data model.

## Timeline

- time: "2026-08-10T01:11:02.382Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["settings-search-navigates-to-setting-row"]
- time: "2026-08-10T01:11:02.382Z"
  kind: "evidence"
  summary: "User suggested on 2026-08-09 that Settings search results can learn from the History module UI. Code review found the reusable patterns in packages/app/src/screens/sessions-screen.tsx and packages/app/src/components/hosts/host-filter.tsx."
