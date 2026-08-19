---
id: "chat-replay-on-switch-and-multi-chat-slideshow-state-of-investigation-handoff"
kind: "finding"
title: "Chat replay-on-switch and multi-chat slideshow: state of investigation, handoff for a fresh session"
status: "proposed"
tags: ["finding","client-performance","chat-scrolling","handoff"]
created_at: "2026-08-19T02:43:45.378Z"
updated_at: "2026-08-19T02:43:45.378Z"
---
# Chat replay-on-switch and multi-chat slideshow: state of investigation, handoff for a fresh session

<!-- compiled_truth -->

**Date:** 2026-08-19. **Two related but distinct user-reported symptoms**, both still open after several sessions of work. This page exists so a fresh session does not re-derive the last several hours from scratch, and so debugging stops depending on the user manually copying DevTools console output.

## Symptom 1: switching to a chat sometimes replays it ("plays in front of me")

Originally reported as: leave a session a while, 10-20 messages with tool calls accumulate, switch to that chat, watch it all type out. User later refined this into two cases after other fixes landed:
1. Most switches: correct final state after a short delay (switching itself feels slower than it used to).
2. Occasionally: switch is fast, then content visibly types out afterward.

### What was tested and DISPROVEN
`TurnRevealTicker` (`packages/app/src/agent-stream/turn-reveal.ts`) paces revealed character count for the live turn's assistant text. Hypothesis was: the hide→visible return-snap (`pendingReturnSnap` latch, armed by observing `wasVisible` flip false) fails to arm when a tab switch is too fast for an intermediate `visible:false` render to land, so the ticker mistakes stale backlog for live growth and paces through it.

Temporary instrumentation was added directly in `turn-reveal.ts` (still live, gated behind a `debugLabel` param threaded from `view.tsx`, logging via `console.info("[reveal-trace:...]")` and a capped in-memory ring buffer at `window.__revealTrace`) to test this. **Every hide→visible transition captured in the traces obtained so far snapped correctly with zero animated `TICK`s across the jump** - the latch worked every time it was exercised. The hypothesis does not hold for the cases captured.

### Leading untested hypothesis: cold mount / pagination catch-up, not hide↔show
User clarified the case-2 replay happened "at the start" - i.e. on first opening a chat this session, not a return from backgrounding. In the one trace available for that scenario, the target jumped from a small initial value (127) to a much larger one (3074) **in a single `UPDATE` call**, then was paced out via many `TICK`s while `visible` stayed `true` throughout (no hide/show event at all, so the tested mechanism never engages). A single large jump in one call is inconsistent with token-by-token live streaming (which produces many small incremental deltas) and consistent with a chunk of **already-written history arriving as one bulk flush after the ticker's very first render** (constructor snap only protects the first render; a chunk arriving in a *later* render during the same mount-time catch-up is indistinguishable from genuinely new live text). This was the original hypothesis from early in the investigation, before effort shifted to testing the hide/show path instead. It has NOT been directly tested - doing so is the top priority for a fresh session.

To test it: instrument (or read existing logs from) whichever code computes `displayedStreamItems`/history sync for a chat's first mount this session, and check whether the daemon really was mid-generation (matches "genuinely live") vs the client was still catching up via `fetch_agent_timeline_response` pagination for an already-completed turn (matches "history mistaken for live"). The daemon protocol messages `fetch_agent_timeline_request`/`_response` and the client's `planInitialAgentTimelineSync` / history-sync generation counters (`agentHistorySyncGeneration` in `session-store.ts`) are the places to look.

## Symptom 2: app becomes a slideshow with 4-6+ chats open/running

### Fixed and verified this session
`session-store.ts`'s `releaseAgentStreams` sweeps ~12 per-agent Maps clean when a chat's stream buffers are released (closed/archived/LRU-evicted), with an explicit comment: *"per-agent bookkeeping with no owner once the chat's buffers are gone... on an orchestrator workload, one entry per sub-agent ever spawned."* `queuedMessages` (the composer's local queue sidecar, `composer/queue.ts`) was missing from that list - confirmed live via the client's own resource-report devbar, which flagged `queuedMessages.length` as the fastest-growing metric (+108/min) in a real session with many agents. Fixed by adding it to the sweep (three-line change, typecheck clean, existing retention + composer-queue test suites both green - 19 tests).

### Confirmed still live, not yet fixed
Live daemon metrics (`ws_runtime_metrics` in `daemon.log`) pulled from the user's actual dev session at the time of the "6 chats, slideshow" report showed: `timelineStats: {totalItems: 57693, maxItemsPerAgent: 16615}` (one single chat retaining 16,615 timeline items), `eventLoopDelay.maxMs: 292.6`, and `bufferedAmount` backing up to 63KB (daemon producing faster than the client drains). This matches an **already-confirmed, still-open structural finding** from `finding-2026-08-02-static-code-audit` (Otto Knowledge): the daemon's per-agent in-memory timeline store (`agent-timeline-store.ts`) has no eviction, and the client's `agentStreamTail`/`agentStreamHead` mirror that. Fixing this needs a design decision (bounded in-memory tail + page from a durable store that isn't wired in production yet, vs. a plain cap) - see that finding's "Structural items" section.

Also re-verified during this session: `F5` (descriptor-map rebuild cost) and quick-wins `Q8` (fence-highlight debounce) and `Q10` (per-group bubble-text listener buckets) from that same audit **already appear fixed in current code** (`workspaceDescriptor` scoped-call metrics are cheap live; `fence-highlight-debounce.ts` and `listenersByGroup` both exist). Do not re-propose those. `F1` (tool-result truncation cap) also appears present (`RESULT_HEAD_CHARS = 26_000` in `otto-tool-serialization.ts`). F2's quadratic re-highlight risk and F4 (uncapped streamed tool-input snapshots) were not re-verified this session - check current state before assuming either is still open or already fixed.

## The diagnostics-tooling gap (fix this first - it blocks efficient debugging of both symptoms above)

The user is understandably worn out on manually copying DevTools console output and pasting screenshots of the metrics footer. Two things worth knowing before a fresh session repeats work:

1. **A file-based performance-capture mechanism already exists and is apparently under-wired.** `packages/desktop/src/daemon/daemon-manager.ts` registers an IPC handler `write_performance_capture` (line ~642) whose implementation (`writePerformanceCapture`, line ~145) writes JSON capture files to `$OTTO_HOME/performance-captures/capture-<timestamp>-<uuid>.json` with a 20MB cap - a complete, already-built, already-tested-looking feature. The renderer-side caller is `packages/app/src/diagnostics/resource-report/performance-capture.ts:90`. **This was not traced to completion** - it was not confirmed whether the "Run app diagnostic" sheet (`app-diagnostic-sheet.tsx`, which currently only does `Clipboard.setStringAsync`) or the metrics-bar footer actually triggers this path, on what cadence, or why the user's several manual captures did not turn up anywhere findable. First move in a fresh session: check whether `$OTTO_HOME/performance-captures/` (both the dev home and the installed home) already has files sitting in it before building anything new.
2. **The `window.__revealTrace` ring buffer (added this session in `turn-reveal.ts`) has the same problem**: it survives without the console open, but still requires the user to run a manual `copy(...)` command and paste it here. It should be made to auto-flush through the same kind of desktop IPC bridge as `write_performance_capture`, so a fresh Claude session can just read a file under `$OTTO_HOME` directly - no user action required at all. This is the concrete fix for "I should be able to do this yourself."

## Recommended order for a fresh session
1. Check `$OTTO_HOME/performance-captures/` on both homes for anything already there from the user's earlier manual captures.
2. Wire (or fix the wiring of) automatic file persistence for both the resource-report captures and the reveal-trace buffer, through the existing `write_performance_capture`-style IPC bridge - no user copy/paste for either, ever again.
3. Test the cold-mount/pagination hypothesis for Symptom 1 directly, using the newly-autonomous capture path.
4. Revisit Symptom 2's structural per-agent timeline eviction gap only once 1-3 are in place, since it's a bigger design decision and the tooling from 1-2 will make measuring its real impact far cheaper.

## Timeline

- time: "2026-08-19T02:43:45.378Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-19T02:43:45.378Z"
  kind: "evidence"
  summary: "Session transcript 2026-08-19: live daemon ws_runtime_metrics pull (packages/desktop/.dev/otto-home/daemon.log), client resource-report devbar screenshot, turn-reveal.ts instrumentation traces (multiple), session-store.ts releaseAgentStreams fix (landed), grep confirmation of write_performance_capture registration/impl in daemon-manager.ts and its renderer caller in performance-capture.ts, grep confirmation that F5/Q8/Q10/F1 fixes from finding-2026-08-02-static-code-audit are present in current code."
