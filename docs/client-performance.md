# Client performance

How the app measures its own frame rate, retained state and daemon traffic, what those numbers mean,
and the invariants that keep the measurement honest. Read this before changing anything under
`packages/app/src/diagnostics/resource-report/`, and before making a performance claim about the
client — the whole point of this subsystem is that claims come with numbers.

Sibling page: [terminal-performance.md](terminal-performance.md) covers the terminal pipeline
specifically (its own coalescers, its own benchmark). This page covers the app as a whole.

## Why the client needs its own instrument

The daemon has had runtime metrics for a long time (`ws_runtime_metrics` in `daemon.log`, plus
`diagnostics.request`). The client had none. That is the wrong way round for the most common
complaint — "the app gets slower the longer it stays open" — because the Visualizer, which runs in a
**separate Electron `<webview>` process**, stays perfectly smooth while the rest of the app
degrades. A separate process being unaffected is the tell: the problem is the app's own JS thread,
its heap, or what it does with what the daemon sends it. None of those were measurable.

## The subsystem

`packages/app/src/diagnostics/resource-report/`:

| Module                        | Does                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `frame-rate-sampler.ts`       | Turns `requestAnimationFrame` timestamps into fps / p95 / jank counts. Pure — driven by timestamps, not a loop |
| `container-census.ts`         | Walks client state and emits one metric per container it finds, keyed by path                                  |
| `collect-resource-metrics.ts` | The only impure module: reads the zustand stores, the react-query cache, the DOM, the heap, the daemon clients |
| `resource-metrics.ts`         | Shapes those readings into the flat metric record (pins the metric namespace)                                  |
| `resource-trend.ts`           | Least-squares fit over the sample ring → **ranked growth**, the leak finder                                    |
| `resource-monitor.ts`         | The singleton: rAF loop + census interval + bounded ring buffer                                                |
| `runtime-counters.ts`         | Patches the timer globals to count live intervals and pending timeouts                                         |
| `format-resource-report.ts`   | Renders it as the `label: value` text the rest of `diagnostics/` produces                                      |

Surfaces:

- **Metrics screen**, pinned along the bottom (`components/client-resource-bar.tsx`) — live readout.
- **Settings › Diagnostics › Run app diagnostic** — the `Client resources` sections, copyable.
- **`window.__ottoResourceMonitor`** — the test bridge the soak spec reads.

Turn it off with **Settings › Diagnostics › Performance monitoring** (`resourceMonitorEnabled`,
default on). Off stops the frame loop and the census interval.

## Invariants (the easy-to-break ones)

- **The monitor must not become the leak it hunts.** The sample ring is capped
  (`DEFAULT_RESOURCE_SAMPLE_CAPACITY`, ~6h at 10s). The census key space is capped by collapsing
  dynamic keys to a wildcard segment: `sessions.<wildcard>.agents.size` is one metric across every
  host, never one per host id. A census that emitted ids would grow its key space with the data.
- **Arrays are leaves in the census.** Emitting `.length` is the whole signal; descending into
  elements would make the census O(timeline items) on every tick, which is itself a perf bug.
- **rAF sampling is web/Electron only.** On native a permanently scheduled frame callback stops the
  JS thread idling, which costs battery to measure a desktop symptom.
- **Stalls are excluded from frame statistics.** A hidden window produces one enormous gap; counted
  as a frame it would sink every percentile and make an idle app look like the worst offender. Gaps
  over `STALL_FRAME_MS` are counted separately as `frames.stalls`.
- **Growth ranking is relative, and gated on monotonicity.** Ranking by raw slope would always
  return bytes; ranking without the monotonicity gate would always return whatever oscillates most.
  A leak is something that _only ever climbs_.
- **Monotonic is not the same as unbounded.** This is the trap that cost a wrong diagnosis once
  already: a metric that climbs to a plateau and stays there has `monotonicity == 1`. Always read
  the per-sample series before calling something a leak — `min`/`max`/`first`/`last` in the trend
  report, or the raw samples from the bridge.
- **Timer counters patch the globals once, before the React tree mounts.** They are installed from
  `app/_layout.tsx` module scope. Installing later means an unknown baseline; unpatching mid-session
  would corrupt the counts, which is why the `resourceMonitorEnabled` setting stops the _sampling_
  and leaves the patch in place.
- **`EventTarget.prototype.addEventListener` is deliberately not patched.** Hotter path, and
  double-adds of an identical listener are DOM no-ops but would still be counted — wrong in exactly
  the case you would want to trust it.

## Reading `traffic.handlerMs` correctly

`traffic.*` comes from `DaemonClientRuntimeMetrics` in `packages/client`, summed across connected
hosts. `handlerMs` is **main-thread time spent inside the inbound message handler** — decode,
validate, dispatch to the store.

It does **not** include the React re-render that the resulting store write triggers. So
`Share of session: 0.25%` bounds the _decode_ cost of daemon chatter, and says nothing about the
_consequence_ cost. A connection can be cheap to decode and still be the reason the UI stutters, if
each message fans out into a large mounted subscriber set. Do not quote the share as "the daemon
connection is not the problem" — quote it as "decoding is not the problem".

**The client's wire metrics were dormant until 0.6.7.** `DaemonClientRuntimeMetrics` existed but was
only constructed when an embedder passed `runtimeMetricsIntervalMs`, and nothing in `packages/app`
ever did. The counters are now always constructed; the interval still gates only the periodic
`ws_runtime_metrics_client` log line.

## Measuring

**Unit level** — the pure modules have tests next to them; run the one you changed:

```bash
npx vitest run packages/app/src/diagnostics/resource-report/resource-trend.test.ts --bail=1
```

**Soak** — `packages/app/e2e/client-resource-soak.spec.ts`, opt-in like the terminal perf specs:

```bash
OTTO_RESOURCE_SOAK_E2E=1 OTTO_RESOURCE_SOAK_CYCLES=12 npx playwright test client-resource-soak
```

Two tests, and the pairing is the method:

1. **`repeated chat cycles`** — same workspace, same chat, one more turn each cycle.
2. **`workspace switching alone`** (the control) — identical navigation churn, **no turns**, so the
   transcript never grows. Anything still climbing here cannot be explained by "the conversation got
   longer".

The control is what makes the soak diagnostic rather than descriptive. Run both; read the delta.

**The rule the harness must obey: navigate in-app, never `page.goto`.** A reload rebuilds every
store and empties the query cache — it resets precisely the state being measured. The first version
of this spec used `page.goto` per cycle and reported a perfectly healthy app.

**In production** — Settings › Diagnostics › Run app diagnostic, and copy. The `Client resources`,
`Client frame drift`, `Client growth ranking`, `Daemon traffic` and `Query cache hotspots` sections
are all in the same paste as the daemon's.

## Known properties of the client (as measured)

These are the structural facts the instrument has established. They are properties of the code as it
stands, not a status report — what is being done about them is a row in
[`projects/README.md`](../projects/README.md#performance), and the evidence, method and dated
numbers are in
[`findings/client-performance/`](../findings/client-performance/2026-07-25-fps-degradation.md).

- **Mounted workspace trees are never released.** Visiting a workspace mounts its tree and it stays
  mounted for the life of the session — deliberate (instant switch-back), bounded by
  workspaces-visited rather than by time, but never reclaimed. Each retained tree keeps its live
  `useQuery` observers and re-renders on every store write for the rest of the session, so the cost
  of a session is a function of how many workspaces it has touched.
- **Navigation re-fetches state the client already holds.** Returning to a workspace re-issues
  `fetch_agent_timeline` and refreshes terminals, even when nothing changed. This is what the
  connection indicator reacts to.
- **`agentStreamTail` / `agentStreamHead` have no per-agent eviction.** Both are keyed by agent id
  and only ever cleared wholesale by `clearSession` — no cap, no release on chat close or archive.
- **The timer counters are the fastest "not this" in the toolkit.** `runtime.liveIntervals` staying
  flat retires the timer-leak hypothesis at a glance, and it has stayed flat in every run so far.
