# Why app-wide FPS degrades over a long session

**Date:** 2026-07-25 · **Question:** the app gets progressively worse the longer it stays open, while
the Visualizer stays smooth. Where does it go?

Instrument built for this investigation:
[`docs/client-performance.md`](../../docs/client-performance.md). Resulting work:
[`projects/README.md` → Performance](../../projects/README.md#performance).

## Method

The instrument did not exist — the daemon had runtime metrics, the client had none — so it was built
first: frame timing, a retained-state census over every client store, react-query cache and DOM
counts, live timer counts, and daemon-traffic accounting including main-thread handler time.

Measurement is a **paired soak** (`packages/app/e2e/client-resource-soak.spec.ts`):

1. **Chat cycles** — same workspace, same chat, one more turn per cycle.
2. **Navigation only** (the control) — identical navigation churn, **no turns**, so the transcript
   never grows. Anything still climbing here cannot be explained by "the conversation got longer".

```bash
OTTO_RESOURCE_SOAK_E2E=1 OTTO_RESOURCE_SOAK_CYCLES=12 npx playwright test client-resource-soak
```

**Environment:** dev build (unminified bundle, React dev build), msedge via Playwright, mock
provider, 12 cycles per test, 3 seeded workspaces. Absolute numbers are dev-mode and not
production-representative — **the comparisons are the finding, not the magnitudes.**

**Two harness errors worth recording**, because both produced a confidently healthy report:

- The first version called `page.goto` per cycle. A reload rebuilds every store and empties the query
  cache — it resets exactly the state under measurement. The harness must navigate in-app.
- The traffic numbers were empty on the first instrumented run. `DaemonClientRuntimeMetrics` was only
  constructed when an embedder passed `runtimeMetricsIntervalMs`, and nothing in `packages/app` ever
  did, so client-side wire accounting had never run. Fixed as part of this work.

## Results

| Reading                   | Chat cycles     | Navigation only |
| ------------------------- | --------------- | --------------- |
| fps, first → last decile  | 101.6 → 76.3    | 93.0 → 59.6     |
| p95 frame                 | 12.5ms → 18.3ms | 12.4ms → 41.7ms |
| `query.observers`         | 187 → 624       | 187 → 421       |
| `query.queries`           | 43 → 80         | 43 → 79         |
| `runtime.liveIntervals`   | 3 → 3           | 3 → 3           |
| `runtime.pendingTimeouts` | 8 → 9           | 8 → 9           |
| `dom.nodes`               | 424 → 2315      | 424 → 775       |
| daemon messages           | 2160            | 197             |
| `traffic.handlerMs` share | 0.25%           | 0.81%           |

The symptom reproduces: **93 → 60 fps and p95 12.4ms → 41.7ms in 15 seconds of navigation with no
new content at all.**

## Hypotheses retired

| Hypothesis                   | Retired by                                                             |
| ---------------------------- | ---------------------------------------------------------------------- |
| Timer leak                   | `runtime.liveIntervals` flat at 3 in every run; pending timeouts 8 → 9 |
| Unbounded query-cache growth | `query.queries` 43 → 80 and stops; `query.unobserved` 4 → 6            |
| Observer leak                | Plateaus once each workspace has been visited — the series below       |
| Message decode cost          | 0.25% of wall clock across 2160 messages, mean 0.163ms each            |

## The measurement that changed the diagnosis

Observer counts read as a textbook leak: 187 → 421, monotonicity 1.00, `min == first`,
`max == last`, never once decreasing across 12 identical cycles — and per-family attribution showed
**all 22 query families growing in proportion**, which reads as "React trees are accumulating":

```
app-settings                 57 -> 125  (+68)
desktop-settings             26 ->  56  (+30)
keyboard-shortcut-overrides  24 ->  48  (+24)
daemon-config                13 ->  31  (+18)
archive-agent-pending         9 ->  27  (+18)
terminals                     2 ->   4   (+2)
```

Then the per-cycle series:

```
app-settings                 57 91 125 125 125 125 125 125 125 125 125 125 125
desktop-settings             26 41  56  56  56  56  56  56  56  56  56  56  56
keyboard-shortcut-overrides  24 36  48  48  48  48  48  48  48  48  48  48  48
terminals                     2  3   4   4   4   4   4   4   4   4   4   4   4
```

Three workspaces, three steps, then flat for ten more cycles. **Monotonic, but bounded.** A plateau
and a leak are identical in any summary that reports only first/last and monotonicity. This is now
an invariant in the instrument's documentation: read the series before calling something a leak.

## What is actually true

### 1. Mounted workspace trees are never released

Visiting a workspace mounts its tree; it stays mounted for the life of the session. That is
deliberate — instant switch-back — and it is bounded by workspaces-visited rather than by time. But
nothing reclaims one, and each retained tree keeps its full set of live `useQuery` observers and
re-renders on every store write for the rest of the session.

**1 → 3 workspaces = 187 → 421 observers and roughly −35% frame rate.** Across a working day and many
workspaces, that is the reported symptom. The Visualizer is unaffected because it is a separate
Electron `<webview>` process — which is exactly why its smoothness was the useful clue.

### 2. Navigation re-fetches state the client already holds

Twelve workspace round-trips that changed nothing produced:

- **48 × `fetch_agent_timeline_response`** — 175 KiB, 4 per cycle
- **69 × `terminals_changed`**
- **47 × `workspace_setup_status_response`**

This answers the observation that the connection indicator fires far more than it used to: the
chattiness is real, and it is largely navigation-triggered refetch of already-held state rather than
agent traffic.

### 3. Daemon traffic is high-volume but cheap to decode

Chat soak, 2m19s, 3 agents, 12 turns: 2160 messages, 1.2 MiB, **0.35s of handler time = 0.25% of the
session**, mean 0.163ms per message. `agent_stream` is 1683 of those messages and 124ms of the time.

**Caveat that keeps the hypothesis alive.** `handlerMs` covers decode, validate and dispatch. It does
**not** cover the React re-render each store write triggers. So this retires "decoding daemon
messages is the bottleneck"; it does not retire "daemon push volume is the bottleneck". Combined with
finding 1, the plausible remaining mechanism is `push rate × mounted subscriber count`, where both
factors grow over a session. Measuring render cost per inbound message is the missing instrument.

### 4. `agentStreamTail` / `agentStreamHead` have no per-agent eviction

Found by reading, not by the soak — two minutes cannot show it. Both maps are keyed by agent id and
are only ever cleared wholesale by `clearSession`: no cap, no release on chat close or archive. Every
timeline item for every agent opened this session stays in memory. The soak gives the rate
(`agentStreamTail.*.length` 0 → 168 over 12 turns, ~14 items/turn); the unbounded part is the absence
of any release path.

## Not concluded

No behaviour was changed on the strength of this report beyond enabling the client's own traffic
accounting. In particular, **whether to evict cold workspace trees** (LRU + remount on switch-back)
trades instant switch-back for bounded cost, and is a product decision rather than a code one.
