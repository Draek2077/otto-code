---
id: "suggested-task-panel-shares-inline-provider-model-selection"
kind: "requirement"
title: "Suggested-task panel shares inline provider and model selection"
status: "proposed"
tags: ["suggested-tasks","model-selection","responsive-layout","ux"]
created_at: "2026-09-05T15:29:15.603Z"
updated_at: "2026-09-05T16:06:49.094Z"
---
# Suggested-task panel shares inline provider and model selection

<!-- compiled_truth -->

The suggested-task panel exposes one inline provider/model picker shared by individual New chat, Sub-agent, Worktree, and Start all actions. This session retains the current chat's model. Do not introduce a separate launch dialog. The collapsed panel stays on one row when its contents fit and wraps controls together onto a second row when constrained. Only this panel's picker trigger uses the start button's font size, preserving normal text weight and using smaller provider/chevron icons; other model pickers retain their standard presentation.

## Timeline

- time: "2026-09-05T15:29:15.603Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-05T15:29:15.603Z"
  kind: "evidence"
  summary: "User explicitly requested cross-provider suggested-task launches, then rejected the launch dialog in favor of an inline picker. User confirmed the shared-selection semantics and requested responsive one/two-row layout and local-only typography sizing. Implementation: packages/app/src/suggested-tasks/{launch-card,compact-card,start-controls,overlay}.tsx, additive launch request/capability and daemon handling, docs/suggested-tasks.md. Five focused session tests passed for all three creation modes, failure retention, and in-session queue behavior; build:server, App/server typechecks and targeted lint passed. Browser measurement: 460px panel is 43px high with aligned controls; 375px viewport produces a 343px-wide two-row panel without overflow. Desktop picker and Start all labels both measure 12px, at weights 400 and 600 respectively. Provider menu verified to expose Claude, Codex, Mock Load Test and OpenAI Compatible. A complete real-provider launch has not been verified."
- time: "2026-09-05T16:06:49.094Z"
  kind: "evidence"
  summary: "Verified refinements: the compact picker now uses the existing filled SplitButton + standalone SplitButtonPrimary, removing panel-owned hover/focus/border styling. Task actions align at the top right of wrapping titles; descriptions span the row. At 375px, Sonnet 4.6 1M stays inside a 135.85px trigger with measured 62px label width versus 94px text width and CSS ellipsis. Found and fixed refresh hydration: task changes were the only source of snapshots; successful timeline fetch now sends the current pending list to the requesting socket, including empty lists to clear stale reconnect state. Regression test passes for hydration and clearing; 11 wire-compatibility tests pass, app/server typechecks and scoped lint pass. Browser verification against rebuilt dev daemon 6788 confirmed two existing tasks reappeared after a full page reload without a task mutation. Installed daemon 6868 untouched. Daemon restart persistence remains out of scope; task storage is still in memory."
  source: "User feedback and local implementation/browser verification, 2026-09-05"
