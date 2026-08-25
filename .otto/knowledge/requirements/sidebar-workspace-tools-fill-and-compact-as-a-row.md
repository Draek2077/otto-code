---
id: "sidebar-workspace-tools-fill-and-compact-as-a-row"
kind: "requirement"
title: "Sidebar workspace tools fill available width before compacting"
status: "confirmed"
tags: ["ui","sidebar","workspace-tools","responsive","layout"]
created_at: "2026-08-21T15:39:18.964Z"
updated_at: "2026-08-25T03:32:00.970Z"
---
# Sidebar workspace tools fill available width before compacting

<!-- compiled_truth -->

The active workspace tools toolbar in the left sidebar measures its full available width and uses it without arbitrary per-button caps.

The smallest usable row is icon-only. As the row gains room, labels reveal progressively in a stable, useful order rather than all switching together:

- **Scripts** reveals first.
- The current **Git** primary-action label reveals next.
- **Open** reveals last, because its editor icon remains recognizable while its split button needs the least early width.

With Scripts, Open, and Git all available, the tested thresholds are 304px for Scripts, 356px for Git, and 392px for Open. Revealed controls share the remaining width; controls whose labels are still hidden stay icon-only with their existing accessible names and tooltips. If Scripts is unavailable, its width is not reserved and Git becomes the first label to reveal.

## Timeline

- time: "2026-08-21T15:39:18.964Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:39:18.964Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21, supported by screenshot showing icon-only controls despite ample sidebar width and an overflowing Scripts control. Implemented in sidebar-active-workspace-tools.tsx plus the shared Scripts, Open in Editor, and Git split-button fill styles."
- time: "2026-08-25T03:32:00.970Z"
  kind: "decision"
  summary: "User requested fluid progressive label reveal on 2026-08-24; implemented and verified with focused unit test, app lint, and app typecheck."
