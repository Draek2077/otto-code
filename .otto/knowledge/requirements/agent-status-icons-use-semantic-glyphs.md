---
id: "agent-status-icons-use-semantic-glyphs"
kind: "requirement"
title: "Agent status icons use semantic glyphs"
status: "confirmed"
tags: ["chat", "workspace", "sidebar", "status", "icons", "interaction-design"]
created_at: "2026-08-14T15:36:32.184Z"
updated_at: "2026-08-14T15:42:58.392Z"
---

# Agent status icons use semantic glyphs

<!-- compiled_truth -->

Chat tabs and workspace sidebar rows use a shared status-icon mapping that prioritizes semantic recognition over a common circular silhouette: `attention` uses `Siren`, `needs_input` uses `SirenQuestion`, and `failed` uses `Error`. The icons replace the normal tab or workspace glyph for actionable states; running remains a loader and done/idle remains unbadged.

## Timeline

- time: "2026-08-14T15:36:32.184Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T15:36:32.184Z"
  kind: "evidence"
  summary: "User direction in this chat on 2026-08-14. Implementation surface: packages/app/src/components/status-bucket-icon.tsx, shared by workspace tabs and sidebar workspace rows."
- time: "2026-08-14T15:42:58.392Z"
  kind: "evidence"
  summary: "Implemented and verified on 2026-08-14: `StatusBucketIcon` maps `attention` to `Siren`, `needs_input` to `SirenQuestion`, and `failed` to `Error`; workspace tabs and sidebar rows consume this shared component. Targeted lint and repository typecheck passed."
  source: "Implementation and verification in this chat."
