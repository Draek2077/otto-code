---
id: "finding-2026-07-25-navigation-refetch-and-stream-retention"
kind: "finding"
title: "Cutting the navigation path's redundant round-trips, and bounding the stream buffers"
status: "confirmed"
tags: ["finding", "client-performance"]
created_at: "2026-08-16T22:16:11.433Z"
updated_at: "2026-08-16T22:16:11.433Z"
---

# Cutting the navigation path's redundant round-trips, and bounding the stream buffers

<!-- compiled_truth -->

**Date:** 2026-07-25 · **Question:** two of the three open items from
[[finding-2026-07-25-fps-degradation]] - how much of the navigation path's daemon
traffic is the client re-asking for state it already holds, and what does it cost to make
`agentStreamTail` / `agentStreamHead` releasable?

Neither depends on the workspace-tree retention question, which is
[[finding-2026-07-25-workspace-tree-retention]]. Nothing here changes deck retention.

Instrument: [`docs/client-performance.md`](../../../docs/client-performance.md). Resulting work:
[`projects/README.md` → Performance](../../../projects/README.md#performance).

## Method

The paired soak, navigation-only arm - the control, because no turns run, so nothing about the
transcript grows and every message counted is navigation churn:

```bash
OTTO_RESOURCE_SOAK_E2E=1 OTTO_RESOURCE_SOAK_CYCLES=12 \
  npx playwright test client-resource-soak -g "workspace switching alone"
```

**Environment:** dev build (unminified bundle, React dev build), msedge via Playwright, mock
provider, 12 cycles, 4 seeded workspaces, all 4 visited. Absolute numbers are dev-mode and not
production-representative - **the comparisons are the finding, not the magnitudes.**

Note the workspace count: the earlier soak seeded 3, and 4 is the current default (see the
workspace-tree finding for why that mattered). These numbers are therefore **not** directly
comparable to the 48 / 69 / 47 counts in the original report; before and after here were both taken
at 4 workspaces.

**A harness caveat that cost two runs, and is worth recording.** The soak reads the resource
monitor out of a live page served by Metro. A source file saved anywhere in `packages/app` while it
runs hot-reloads that page, which re-evaluates the monitor module and starts its ring buffer over.
Two runs reported `Samples: 2` and `Samples: 6` instead of 13 for exactly this reason, and one
crashed outright on a half-written module (`WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES is not defined`).
The frame and census series are worthless when this happens; the **daemon-traffic counters are
not**, because they live on the daemon client in `packages/client`, not on the monitor. If a soak
run reports fewer samples than cycles, the series is contaminated - read the traffic table and
re-run for anything else.

## What the navigation path was re-asking for

Three things, per workspace round-trip, none of which had changed:

1. **`fetch_agent_timeline`.** Focusing a chat pane called `ensureAgentIsInitialized`
   unconditionally. With history already applied it plans an `after` catch-up, so the round-trip
   almost always returned nothing. It is redundant while the socket has stayed up: live
   `agent_stream` keeps the tail current, and the reducer's own seq/epoch gate
   (`classifySessionTimelineSeq`) already requests a catch-up the moment it sees a gap or an epoch
   change.
2. **`workspace_setup_status`.** `ensureSetupStatus` cached only a _positive_ answer. A successful
   response carrying no snapshot - "this workspace has no setup" - left no marker, so every route
   focus asked again, forever.
3. **`terminals_changed`.** The terminals query is `enabled` on route focus, so leaving a workspace
   drops its observers and returning adds them back; the push router unsubscribed and re-subscribed
   in step, and the daemon answers every subscribe with a full snapshot. Once (1) was fixed this
   became the **largest** inbound cost on the navigation path after the one-off `status` frame.
   Fixed as a debounce (`TERMINAL_SUBSCRIPTION_LINGER_MS`, 15s) rather than a retention policy: it
   only delays the unsubscribe, so a round-trip inside the window is free and a workspace genuinely
   left still stops pushing shortly after. Deliberately not a second answer to "how long do we keep
   workspace state alive" - that question belongs to the workspace deck's mounted set.

## Results

Navigation-only arm, 12 cycles, 4 workspaces, session-cumulative inbound traffic. The middle column
is a run taken with only the first two fixes in, so the terminal-subscription linger is attributed
separately rather than folded into one number.

| Reading                           | Before            | Timeline + setup | All three       |
| --------------------------------- | ----------------- | ---------------- | --------------- |
| `fetch_agent_timeline_response`   | 33 msgs, 67.4 KiB | 4 msgs, 8.2 KiB  | 4 msgs, 8.2 KiB |
| `workspace_setup_status_response` | 38 msgs, 6.9 KiB  | 4 msgs, 748 B    | 4 msgs, 748 B   |
| `terminals_changed`               | 51 msgs, 12ms     | 67 msgs, 13ms    | 4 msgs, 1ms     |
| inbound messages, total           | 232               | 157              | **99**          |
| `traffic.handlerMs`               | 267.2ms           | 137.8ms          | **129.5ms**     |

**Four responses for four workspaces visited is the floor** in all three rows - one genuine
first-open each. What is left is not redundancy.

Note `terminals_changed` in the middle column: 51 → 67 with nothing touching it. That is run-to-run
variance on an untouched metric, and it is the reason the third column exists - without a run that
isolates the change, a 51 → 4 claim would be indistinguishable from noise of that size going the
other way.

The chat-cycles arm moves the same way (51 → 14 timeline responses, 46 → 17 setup-status), but its
totals are confounded: `agent_stream` dominates that arm and the mock provider does not emit
identical text run to run, so read the per-type rows there, not the totals.

**Bytes fell far less than messages in the chat arm** (261 → 192 KiB against a 73% drop in message
count). That is the expected shape: what was removed was near-empty `after` catch-ups. This is a
request-count and latency win, not a bandwidth one.

## The plateau, read as a series

The control's 14-sample series, which is the reading the instrument's own invariant demands:

```
mounted trees          1   2   3   4   4   4   4   4   4   4   4   4   4
query.observers      199 317 435 553 553 553 553 553 553 553 553 553 553 553
dom.nodes            457 644 808 954 972 958 954 954 972 972 972 972 972 972
agentStreamTail.size   1   2   3   4   4   4   4   4   4   4   4   4   4   4
agentStreamRetainers   1   2   3   4   4   4   4   4   4   4   4   4   4   4
```

Four workspaces, four steps, then flat for the rest of the run. **Monotonic, and bounded** - the
same shape the original investigation recorded, and the same reason it must not be read as a leak.

`frames.fps` over the same run: `63 60 56 52 53 55 31 65 56 65 50 64 57 71`, and the run before it
`87 49 48 55 54 56 63 45 53 70 64 58 52 65`. Both oscillate without trend, and the two runs disagree
about the sign: the earlier one's first-versus-last-decile verdict reads "degraded", this one's
reads "no degradation", from the same code. **The soak is explicitly not a frame-rate benchmark** (a
Playwright browser is not a fair FPS sample) - nothing here should be quoted as a frame-rate result
in either direction.

## Stream-buffer retention: what was decided

`agentStreamTail` / `agentStreamHead` had no per-agent release. Two things made that worse than the
original note implied:

- Every agent on the host accumulates a tail, not just the ones whose chat was opened -
  `agent_stream` is reduced into the buffers for every agent, mounted or not.
- The `agent_update {kind:"remove"}` path already cleared the cursor and the applied flag but left
  the buffers, so a removed agent's transcript stayed as _unreachable_ state.

**The release trigger, decided rather than guessed:** an agent's buffers are released when it is not
being displayed AND either it has left the session (deleted, removed, archived) or it is past a cap
of 12 agents, oldest-touched first.

Two things make it safe, and both are load-bearing:

- **"Not being displayed" is explicit, not inferred.** Every surface that renders the buffers
  registers a ref-counted retainer while mounted (`useAgentStreamRetention`). Inferring it from
  focus or lifecycle would blank a mounted background pane - invisible to every other signal in the
  store.
- **Releasing invalidates the resume path.** The buffers are not a standalone cache:
  `agentTimelineCursor` + `agentAuthoritativeHistoryApplied` tell `planInitialAgentTimelineSync` the
  client is caught up. Dropping the buffers without them would make the next open an `after`
  catch-up that returns nothing, onto an empty tail - a blank chat. They are released together.

**The Visualizer is unaffected**, and this was checked rather than assumed: its backfill-and-replay
path calls `client.fetchAgentTimeline(agentId, {direction:"tail", limit:0})` against the daemon
(`use-visualizer-event-adapter.ts`), never these buffers, so a released agent still replays in full
when a tab becomes visible again.

The soak cannot demonstrate the cap - it seeds 4 agents against a cap of 12. `agentStreamTail.size`
plateauing at 4 shows the registry tracking correctly and evicting nothing, which is the right
behaviour at that scale; the cap itself is covered by unit tests
(`stores/session-store-agent-stream-retention.test.ts`, `timeline/agent-stream-retention.test.ts`).
**A soak that ran below the threshold is exactly how the workspace-tree conclusion went wrong**, so
this is stated as untested-by-soak rather than dressed up as verified.

## Not concluded

- **Whether 12 is the right cap.** It was chosen as "more chats than a session realistically has
  open at once, far fewer than a day's worth of agents", not measured. The cost of being wrong is
  asymmetric and cheap in one direction: too low costs a `tail` refetch on reopen, too high costs
  retention. Nothing measures the per-agent cost yet.
- **Render cost per inbound message** is still the missing instrument, unchanged from the original
  report. Every count above is a message count; none of it bounds the React re-render each store
  write triggers.

## Timeline

- time: "2026-08-16T22:16:11.433Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/client-performance/2026-07-25-navigation-refetch-and-stream-retention.md"
