---
id: "paseo-v012-upstream-integration"
kind: "project"
title: "Paseo v0.12 upstream integration"
status: "proposed"
tags: ["upstream","paseo","merge"]
delivery_status: "charter"
progress_completed: 0
progress_total: 2
progress_unit: "merge steps"
created_at: "2026-10-19T19:13:43.404Z"
updated_at: "2026-10-19T19:13:43.404Z"
---
# Paseo v0.12 upstream integration

<!-- compiled_truth -->

# Paseo v0.12 upstream integration

Bring Otto from its Paseo v0.8.0 base (b8e24677e, merged 2026-09-13) up to Paseo v0.12.x, following docs/upstream-merges.md: merge by SHA at stable tags, in an isolated branch, adopting the new upstream owner where it supplies a behavior and keeping Otto features through narrow Otto-owned seams ([[upstream-mergeability-through-otto-owned-seams]]).

## Why now

Four minor releases behind (cap is two). Upstream has moved six owners Otto builds on; every further release adds roughly 150 newly conflicting files. Measurements: [[finding-2026-10-19-paseo-v012-merge-gap]].

## Plan: two merge steps

1. **Step 1: Paseo v0.11.x** (v0.11.0 is 22488d450; take the newest v0.11 patch tag on main at start). Lands the subscription/delivery refactor, Settings page split, usage plugins, audio move and Explorer unification. 605 raw conflicts at v0.11.0. Order: core plumbing (session.ts, owned subscriptions, daemon-client), then Settings plus the settings inventory, then Usage, then voice/audio, then Explorer.
2. **Step 2: Paseo v0.12.x**, after the Markdown decision below. Lands the Markdown engine swap, the phone layout rework, the scripts menu move and the tool presentation catalog.

Rationale: a single jump resolves 915 contested files once and two steps resolve 1,215, but the Markdown swap shipped three days before the v0.12.0 tag on a nightly library with a 2,930-line patch and six in-release fixes. Isolating it lets the plumbing land and get CI-verified first.

## Disposition of upstream rivals (proposed, needs Philippe's calls marked DECIDE)

| Upstream change | Proposed disposition |
| --- | --- |
| Markdown engine to react-native-enriched-markdown (#6973) | DECIDE. Options: (a) two engines: enriched for chat, plan, PR; Otto's markdown-it renderer kept as an Otto-owned document module for File Preview and Knowledge (comment locators, heading navigation, task lists, find, math, footnotes); (b) decline #6973 entirely and keep one Otto engine; (c) adopt fully and drop or re-patch the document features. |
| Usage as built-in plugins (#5465) | Adopt upstream usage UI, plugins and CLI. Keep Otto's ring tints and rate-limit strip on upstream's meter. DECIDE whether Otto keeps OAuth token write-back for Claude/Codex (upstream treats credentials as read-only). |
| Settings split into pages (#5459, #7129) | DECIDE. Proposal: take upstream's section files and primitives as owners, keep Otto's search-first overview as the landing page, decline the phone tiles, regenerate the settings inventory. |
| Audio engine move (#5976, #7200) | Adopt app/src/audio and signal-based play(); add Otto gain as an options argument; port the AudioWorklet capture; rebase Android wake word onto #7200. Verify microphone lifecycle privacy. |
| Explorer tab unification (#5942) | Adopt; move User mode tab filtering and Otto chrome into the shared row. |
| Scripts menu (#7122) | Adopt upstream's version (it now has the service-route affordance Otto ported); re-apply npm script discovery groups. |
| Find (#4589, #4765, #4650) | Adopt upstream pane find as the single owner including terminal; retire Otto's message search bar and SourceFindMatch patch; keep CodeMirror editor search and global chat search. |
| Agent-to-agent steer default (#5164) | Decline; Otto's Default send rule in docs/chat-lifecycle.md stands. |
| Tool presentation catalog (#7283), sender identity (#6373) | Adopt after re-keying to Otto tool names; update the system envelope matcher. |
| Background workspaces (#5039) | Adopt; map schedule runs onto it and retire the server-only hidden flag. |
| Content width (#5680) | Adopt; map Otto's chat width presets onto it. |
| Plugin registry (#6224) | Adopt the mechanism. DECIDE the default registry host (plugins.paseo.sh must not be blindly rebranded to a nonexistent host). |
| Hub | Standing rejection holds. |
| Memory/OOM fixes, relay daemon password, phone fullscreen composer, terminal find, cold diff speedup | Adopt; highest user value in the range. |

## Acceptance

- Each step merged by SHA in its own branch; docs/upstream-merges.md ledger row filled during the merge, including deliberate skips.
- Merge-orphan guard (scripts/merge-orphan-guard.mjs) clean; the wholesale-ours scan run both directions; store reducers and push types each have a caller.
- Typecheck, lint and CI green, plus the e2e specs covering Markdown, voice, settings, usage and Explorer.
- Each DECIDE item resolved by Philippe and recorded as a decision page before its code lands.

## Timeline

- time: "2026-10-19T19:13:43.404Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["upstream-mergeability-through-otto-owned-seams","finding-2026-10-19-paseo-v012-merge-gap","markdown-editing","rendered-markdown-comments-use-source-backed-block-locators","rendered-markdown-tables-use-single-owner-borders","settings-opens-to-search-first-overview","microphone-capture-lifecycle-privacy","otto-agentic-mcp-uses-task-chat-and-orchestration-language","explorer-sidebar-convergence-on-upstream-s-pane-host-system"]
- time: "2026-10-19T19:13:43.404Z"
  kind: "evidence"
  summary: "Drift measurement and hazard analysis in [[finding-2026-10-19-paseo-v012-merge-gap]]. Rival-feature audit of the Paseo 0.9.0 to 0.12.0 changelog performed 2026-10-19 against b8e24677e, cafe4b01c and Otto HEAD 8fcff77f6."
