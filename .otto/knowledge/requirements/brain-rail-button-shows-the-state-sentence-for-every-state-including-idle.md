---
id: "brain-rail-button-shows-the-state-sentence-for-every-state-including-idle"
kind: "requirement"
title: "Brain rail button shows the state sentence for every state, including idle"
status: "confirmed"
tags: ["brain","rail-button","wording","tooltip"]
created_at: "2026-08-17T03:49:39.027Z"
updated_at: "2026-08-22T23:10:17.284Z"
---
# Brain rail button shows the state sentence for every state, including idle

<!-- compiled_truth -->

The Brain rail button (sidebar footer, settings footer, workspace title bar) always carries the state's own sentence from `BRAIN_STATE_LABELS`, including when idle: it reads "Brain - idle" at rest, never the plain "Brain" nav label. The earlier idle special-case (`resolveBrainRailLabel`'s `idleLabel` param, `BRAIN_NAV_LABEL`, and the sidebar `labels.brain` bundle feeding the tooltip) was removed because the user wanted the tooltip to keep the "Brain - <state>" identity in every state. Prefill reads "Brain - processing tokens" (not "processing incoming tokens") so it mirrors "generating tokens".

## Timeline

- time: "2026-08-17T03:49:39.027Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-17T03:49:39.027Z"
  kind: "evidence"
  summary: "User request 2026-07-28: 'Brain icon should have \"Brain - idle\" when it's idle. not just \"Brain\". Also, we should change the \"processing incoming tokens\" to show \"processing tokens\" to match \"generating tokens\".' Implemented in packages/app/src/components/brain/brain-state.ts (`resolveBrainRailLabel` is now a single-arg lookup; `BRAIN_NAV_LABEL` deleted), call sites in left-sidebar.tsx, sidebar-footer-nav.tsx, settings-screen.tsx; tests in brain-state.test.ts."
- time: "2026-08-22T23:10:17.284Z"
  kind: "evidence"
  summary: "The Brain rail now uses the host-level `daemon.brain.enabled` setting as a shared visibility gate. When the setting is explicitly false, the sidebar footer Brain button and workspace title-bar Brain button are omitted; unresolved settings remain visible during initial loading. Added `shouldShowBrainRail` coverage in `packages/app/src/components/brain/brain-state.test.ts`; focused Brain-state tests (42 passed), targeted lint, formatting, and app typecheck passed."
  source: "Implementation verification, 2026-08-22"
  affects: ["brain-rail-button-shows-the-state-sentence-for-every-state-including-idle"]
