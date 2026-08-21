---
id: "sidebar-workspace-tools-fill-and-compact-as-a-row"
kind: "requirement"
title: "Sidebar workspace tools fill available width before compacting"
status: "confirmed"
tags: ["ui","sidebar","workspace-tools","responsive","layout"]
created_at: "2026-08-21T15:39:18.964Z"
updated_at: "2026-08-21T15:39:18.964Z"
---
# Sidebar workspace tools fill available width before compacting

<!-- compiled_truth -->

The active workspace tools toolbar in the left sidebar measures its full available width. Its labeled controls share and use that width without an arbitrary per-button cap. When the full labeled row no longer fits comfortably, all controls switch together to icon-only mode; labels must not overflow or appear inconsistently.

## Timeline

- time: "2026-08-21T15:39:18.964Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:39:18.964Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21, supported by screenshot showing icon-only controls despite ample sidebar width and an overflowing Scripts control. Implemented in sidebar-active-workspace-tools.tsx plus the shared Scripts, Open in Editor, and Git split-button fill styles."
