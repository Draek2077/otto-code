---
id: "ai-generation-actions-use-robot-icon"
kind: "requirement"
title: "AI generation actions use the Robot icon"
status: "confirmed"
tags: ["ui","icons","ai-generation","robot"]
created_at: "2026-08-21T19:10:20.521Z"
updated_at: "2026-08-22T20:18:00.932Z"
---
# AI generation actions use the Robot icon

<!-- compiled_truth -->

User-facing actions that directly request or initiate AI-generated content should use Otto's `Robot` material icon (`robot_2`) as their action glyph. This includes Refine and Compact with AI, Refactor confirmation, Create documentation, artifact create/regenerate, and personality profile or voice-cue generation. Deterministic cleanup, navigation, status, and ordinary agent actions keep their semantic icons.

## Timeline

- time: "2026-08-21T19:10:20.521Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-family-icons"]
- time: "2026-08-21T19:10:20.521Z"
  kind: "evidence"
  summary: "User direction in this chat, implemented in packages/app/src/components/file-tab-pane.tsx, packages/app/src/panels/refine-panel.tsx, packages/app/src/context-management/refine-action.tsx, packages/app/src/editor/refactor-dialog.tsx, packages/app/src/screens/new-workspace-screen.tsx, packages/app/src/components/artifacts/, and packages/app/src/screens/settings/agent-personalities-section.tsx."
- time: "2026-08-22T20:18:00.932Z"
  kind: "evidence"
  summary: "Applied the established `Robot` (`robot_2`) glyph to the Host Settings Metadata entry in `packages/app/src/screens/settings-screen.tsx`, replacing the conflicting `Sparkles`/Skill glyph at the user's direction. Focused formatting and lint plus the App typecheck passed."
  source: "Implementation verification, 2026-08-22"
  affects: ["finding-2026-08-09-settings-ownership-and-visibility"]
