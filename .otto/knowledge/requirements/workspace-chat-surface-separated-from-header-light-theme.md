---
id: "workspace-chat-surface-separated-from-header-light-theme"
kind: "requirement"
title: "Light workspace chat surface stays distinct from the top bar"
status: "proposed"
tags: ["themes", "workspace", "chat", "ui"]
created_at: "2026-08-09T17:08:34.839Z"
updated_at: "2026-08-09T17:52:58.432Z"
---

# Light workspace chat surface stays distinct from the top bar

<!-- compiled_truth -->

Light themes map `surfaceWorkspace` to `surface1`, keeping the workspace chat pane visibly distinct from the top-bar/app `surface0`, consistent with the dark semantic theme mapping.

## Timeline

- time: "2026-08-09T17:08:34.839Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T17:08:34.839Z"
  kind: "evidence"
  summary: "User-reported light-vs-dark screenshots and implementation in packages/app/src/styles/theme.ts, 2026-08-09."
- time: "2026-08-09T17:22:01.258Z"
  kind: "evidence"
  summary: "The light neutral workspace step should match the dark neutral separation: surface0 #ffffff to surface1 #f8f8f6, preserving a barely warm theme cast rather than using neutral #fafafa."
  source: "User clarification and implementation in packages/app/src/styles/theme.ts, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:23:02.618Z"
  kind: "evidence"
  summary: "The same surface-step adjustment applies to every light palette: Sherbet #fdf7f2→#f6efe9, Meadow #f6faf7→#eff5f0, Terracotta #fdf8f5→#f6f1ec, Horizon #f6f9fd→#eff4f8, and Powder #f6f7f9→#eff0f3. Each preserves its palette hue while keeping approximately seven channels of separation."
  source: "User clarification and implementation in packages/app/src/styles/theme.ts, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:35:27.736Z"
  kind: "evidence"
  summary: "Preview baseline re-anchors all normal light themes to mirrored dark-base distances and uses a seven-channel surface0→surface1 step; dark theme surface1 values are normalized to the same +7 RGB step. Black-mode scoped colors remain unchanged because this requirement concerns normal chat surfaces."
  source: "User clarification and implementation in packages/app/src/styles/theme.ts, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:36:36.020Z"
  kind: "evidence"
  summary: "Re-anchoring light surface0 to approximately #e1e1dd recolored the entire app canvas and was rejected by visual preview. Light surface0 must remain the established canvas base; the chat/title-bar distinction belongs in surfaceWorkspace/surface1."
  source: "User screenshot and correction in packages/app/src/styles/theme.ts, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:38:40.376Z"
  kind: "evidence"
  summary: "The visible workspace chat body is painted by styles.content, which must use surfaceWorkspace; changing only the semantic token was insufficient because styles.content explicitly used surface0 and masked the intended chat/title-bar contrast."
  source: "Implementation in packages/app/src/screens/workspace/workspace-screen.tsx, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:40:56.323Z"
  kind: "evidence"
  summary: "Seven RGB levels remained too subtle in the rendered workspace. The preview now uses a 14-channel surface0→surface1 separation for all normal light and dark themes, while the title bar stays on surface0 and the chat content wrapper uses surfaceWorkspace."
  source: "User clarification and implementation in packages/app/src/styles/theme.ts and packages/app/src/screens/workspace/workspace-screen.tsx, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:42:39.177Z"
  kind: "evidence"
  summary: "User rejected the surface re-anchoring and 7/14-level experiments; all experiment changes were rolled back. The theme and workspace surface implementation is restored to its pre-experiment state for a fresh design discussion."
  source: "User-requested rollback in packages/app/src/styles/theme.ts and packages/app/src/screens/workspace/workspace-screen.tsx, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:49:38.714Z"
  kind: "evidence"
  summary: "Daylight now uses a warm three-step surface hierarchy: surface0 #fffdf8, workspace surface1 #faf6ed, and sidebar surface #f4eee4. The light workspace maps surfaceWorkspace to surface1 and the workspace content wrapper paints surfaceWorkspace so chat differs from the title bar."
  source: "User-approved Daylight palette experiment in packages/app/src/styles/theme.ts and packages/app/src/screens/workspace/workspace-screen.tsx, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
- time: "2026-08-09T17:52:58.432Z"
  kind: "evidence"
  summary: "The Daylight and Twilight surface hue shifts were reduced to half their prior accent intensity by interpolating changed surface swatches halfway back toward their original neutral values; surface hierarchy and workspace/title-bar separation were preserved."
  source: "User-approved palette refinement in packages/app/src/styles/theme.ts, 2026-08-09."
  affects: ["workspace-chat-surface-separated-from-header-light-theme"]
