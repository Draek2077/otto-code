# Client performance

How the app measures its own frame rate, retained state and daemon traffic, what those numbers mean,
and the invariants that keep the measurement honest. Read this before changing anything under
`packages/app/src/diagnostics/resource-report/`, and before making a performance claim about the
client - the whole point of this subsystem is that claims come with numbers.

Sibling page: [terminal-performance.md](terminal-performance.md) covers the terminal pipeline
specifically (its own coalescers, its own benchmark). This page covers the app as a whole.

## Why the client needs its own instrument

The daemon has had runtime metrics for a long time (`ws_runtime_metrics` in `daemon.log`, plus
`diagnostics.request`). The client had none. That is the wrong way round for the most common
complaint - "the app gets slower the longer it stays open" - because the Visualizer, which runs in a
**separate Electron `<webview>` process**, stays perfectly smooth while the rest of the app
degrades. A separate process being unaffected is the tell: the problem is the app's own JS thread,
its heap, or what it does with what the daemon sends it. None of those were measurable.

## The subsystem

`packages/app/src/diagnostics/resource-report/`:

| Module                        | Does                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `frame-rate-sampler.ts`       | Turns `requestAnimationFrame` timestamps into fps / p95 / jank counts. Pure - driven by timestamps, not a loop |
| `container-census.ts`         | Walks client state and emits one metric per container it finds, keyed by path                                  |
| `collect-resource-metrics.ts` | The only impure module: reads the zustand stores, the react-query cache, the DOM, the heap, the daemon clients |
| `resource-metrics.ts`         | Shapes those readings into the flat metric record (pins the metric namespace)                                  |
| `resource-trend.ts`           | Least-squares fit over the sample ring → **ranked growth**, the leak finder                                    |
| `resource-monitor.ts`         | The singleton: rAF loop + census interval + bounded ring buffer                                                |
| `runtime-counters.ts`         | Patches the timer globals to count live intervals and pending timeouts                                         |
| `format-resource-report.ts`   | Renders it as the `label: value` text the rest of `diagnostics/` produces                                      |

Surfaces:

- **Metrics screen**, pinned along the bottom (`components/client-resource-bar.tsx`) by default -
  live readout. **Settings › Diagnostics › Show Metrics footer on all pages** moves the same bar to
  the app-shell footer, outside every page's scroll region. The bar has exactly one owner, so it is
  not duplicated on the Metrics screen while the application-wide footer is enabled.
- **Settings › Diagnostics › Run app diagnostic** - the `Client resources` sections, copyable.
- **`window.__ottoResourceMonitor`** - the test bridge the soak spec reads.

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
  the per-sample series before calling something a leak - `min`/`max`/`first`/`last` in the trend
  report, or the raw samples from the bridge.
- **A bounded thing looks unbounded until the run crosses the bound.** The sibling of the trap
  above, and it cost the second wrong diagnosis: the workspace deck evicts at three, the soak seeded
  three, and "never released" and "never reached the cap" produced the identical series. Before
  reading retention off a series, check what caps the thing being measured and **seed above it**.
  Where a cap exists, measure its cause directly (the mounted-tree count) and not only its
  consequence (`query.observers`).
- **`Client frame drift` is not a verdict below ~40 samples.** The bucket is
  `max(1, floor(samples / 10))`, so a 12-cycle soak compares one 10s frame window against one other.
  Single windows inside one steady state have ranged from 29 to 85 fps, and the same configuration
  has produced both verdicts on consecutive runs - including "degraded" with the deck pinned to a
  single workspace. Quote the whole `frames.fps` series, or run long enough for the decile to
  contain something.
- **Timer counters patch the globals once, before the React tree mounts.** They are installed from
  `app/_layout.tsx` module scope. Installing later means an unknown baseline; unpatching mid-session
  would corrupt the counts, which is why the `resourceMonitorEnabled` setting stops the _sampling_
  and leaves the patch in place.
- **`EventTarget.prototype.addEventListener` is deliberately not patched.** Hotter path, and
  double-adds of an identical listener are DOM no-ops but would still be counted - wrong in exactly
  the case you would want to trust it.

## Reading `traffic.handlerMs` correctly

`traffic.*` comes from `DaemonClientRuntimeMetrics` in `packages/client`, summed across connected
hosts. `handlerMs` is **main-thread time spent inside the inbound message handler** - decode,
validate, dispatch to the store.

It does **not** include the React re-render that the resulting store write triggers. So
`Share of session: 0.25%` bounds the _decode_ cost of daemon chatter, and says nothing about the
_consequence_ cost. A connection can be cheap to decode and still be the reason the UI stutters, if
each message fans out into a large mounted subscriber set. Do not quote the share as "the daemon
connection is not the problem" - quote it as "decoding is not the problem".

**The client's wire metrics were dormant until 0.6.7.** `DaemonClientRuntimeMetrics` existed but was
only constructed when an embedder passed `runtimeMetricsIntervalMs`, and nothing in `packages/app`
ever did. The counters are now always constructed; the interval still gates only the periodic
`ws_runtime_metrics_client` log line.

## Measuring

**Unit level** - the pure modules have tests next to them; run the one you changed:

```bash
npx vitest run packages/app/src/diagnostics/resource-report/resource-trend.test.ts --bail=1
```

**Soak** - `packages/app/e2e/client-resource-soak.spec.ts`, opt-in like the terminal perf specs:

```bash
OTTO_RESOURCE_SOAK_E2E=1 OTTO_RESOURCE_SOAK_CYCLES=12 npx playwright test client-resource-soak
```

Two tests, and the pairing is the method:

1. **`repeated chat cycles`** - same workspace, same chat, one more turn each cycle.
2. **`workspace switching alone`** (the control) - identical navigation churn, **no turns**, so the
   transcript never grows. Anything still climbing here cannot be explained by "the conversation got
   longer".

The control is what makes the soak diagnostic rather than descriptive. Run both; read the delta.

`OTTO_RESOURCE_SOAK_WORKSPACES` sets how many workspaces are seeded (default 4). It defaults above
`WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES` on purpose - at or below the cap the deck never evicts, and
the run cannot tell retention from a cap that was never reached.

**The rule the harness must obey: navigate in-app, never `page.goto`.** A reload rebuilds every
store and empties the query cache - it resets precisely the state being measured. The first version
of this spec used `page.goto` per cycle and reported a perfectly healthy app.

**Do not edit app source while a soak is in flight - including from another session.** Metro Fast
Refresh re-evaluates the changed module graph, which rebuilds the React tree and re-creates the
resource monitor singleton with an empty sample ring. It is the `page.goto` mistake arriving from
the editor instead of the harness, and it is harder to spot: the daemon client survives, so traffic
counters run on continuously while the census restarts, and the run reports a plausible-looking
short series rather than an error. Two tells - the sample count comes back far below the cycle
count, or a retained-state series dips **below its own one-unit floor** (a deck holding one
workspace cannot drop below one workspace; only an app rebuild can). In a shared checkout, run the
soak from a git worktree.

**Never time a workspace switch with `expectComposerVisible`.** It resolves `.first()` across every
retained panel, and the deck deliberately keeps the outgoing workspace painted while a cold one
mounts (`useDeferredValue` on a cold selection), so the assertion can be satisfied by the workspace
being navigated _away from_ - it under-reported cold switches by 40%. Wait on the target's own
`workspace-deck-entry-<serverId>:<workspaceId>` instead: an inactive entry is `display: none`, so
its visibility is unambiguous. Note that even this measures **painted**, not **usable** - a cold
mount paints before its timeline refetch lands.

### The conversation corpus (for the "a lot is open" case)

The soak above drives **empty** workspaces with **idle** agents. That makes it a good retention
detector and a poor model of the reported symptom: nobody complains about Otto with four empty chats
open. The corpus fills that gap - a synthetic install with several projects, worktree workspaces
under each, a dozen chats per workspace, hundreds of messages per chat.

```bash
node scripts/seed-perf-corpus.mjs                        # into the dev daemon; open it by hand
node scripts/seed-perf-corpus.mjs --smoke                # 1x1x1, to check the wiring
node scripts/seed-perf-corpus.mjs --clean                # drop the previous corpus first
OTTO_CORPUS_SOAK_E2E=1 npx playwright test perf-corpus-soak   # the measured version
```

The headline test is **`switching between loaded workspaces with both panels open`**, because that
is where the slowdown is actually reported: clicking workspace to workspace in the sidebar, with the
left panel and the explorer both open, so each switch pays for a git status and a diff on top of
mounting the tree. It reports `switch ms` (to painted) and `diff ms` (to a usable Changes list)
separately, then their sum as "switch to usable" -- the panel paints before its diff lands, so
folding them together credits the switch with work the user is still waiting on.

The seeding logic is one module (`scripts/perf-corpus.mjs`) with two callers, the same arrangement
as the boilerplate-project corpus: a number the soak reports has to describe the state a human can
click through, or it stops being evidence about the app they are complaining about. Scale knobs are
`OTTO_CORPUS_PROJECTS` / `_WORKSPACES` / `_CHATS` / `_TURNS` / `_ITEMS`, shared by both callers.
The default is 6 x 4 x 12 x (10 x 30) = 288 chats and ~86k timeline items, which seeds in about
**four minutes** at `OTTO_CORPUS_CONCURRENCY=24` on a developer machine.

Four properties of the corpus are load-bearing. Each exists because the obvious simpler version
produces a corpus that measures the wrong thing:

- **Content is composed, never picked from a fixture list.** The app caches rendered markdown block
  heights keyed by the block's own text. A corpus drawn from a handful of fixed strings hits that
  cache on nearly every block and reports the app as far faster than it is on real conversations.
  `synthetic-conversation.ts` assembles paragraphs from fragments and pins the property with a test
  (distinct assistant texts must exceed 90% of assistant messages).
- **Many small turns, not one big one.** The app decides how much history to keep mounted by walking
  back from the tail to the nearest user message (`findMountedWindowStart`). The mock provider emits
  no user event of its own, so a single 300-item turn contains no user message, the walk runs to
  index 0, and the whole transcript mounts. A corpus built that way defeats the windowing it exists
  to exercise. Each prompt contributes a real user message, so ten 30-item turns give a 300-item chat
  with ten window boundaries in it.
- **Seeds are pinned.** `synthetic-seed: N` in the prompt fixes the generator seed for that turn.
  Without it the seed comes from a per-turn UUID, so two seeding runs build statistically similar but
  byte-different corpora, and an A/B measurement across them attributes a corpus difference to the
  code change under test.
- **Every workspace tree is left dirty.** Eight modified and untracked files per workspace, seeded
  deterministically. The Changes view is not a bystander in the reported case: switching workspaces
  with the explorer open loads a git status and a diff per switch, and a clean corpus makes that free.
  Seeding chats against pristine repos leaves that cost out of every number.
- **Seeding is additive and idempotent.** Existing corpus workspaces and chats are adopted rather
  than duplicated, so raising a scale knob and re-running tops the corpus up instead of doubling it.
  The result reports `chats` (corpus size) separately from `chatsCreated` (what this run paid for);
  collapsing them is how a seeder starts reporting turns it never drove. Only `--clean` resets, and
  it clears the daemon records as well as the repos, because orphaned records get adopted next run.
- **The conversations do not survive a daemon restart - only the repos do.** Agent timelines live in
  the daemon's in-memory `agent-timeline-store`; `seedAgentTimeline` has no production caller, so
  nothing repopulates them on startup. The agent records persist under `$OTTO_HOME/agents/`, so after
  a bounce you are left with the full set of chats, all empty. **Seed, then measure without
  restarting.** This cost a full round of measurements once: the daemon was restarted to clear an
  unrelated problem, every transcript went empty, and the switch numbers taken afterwards described
  empty workspaces (~2,600 DOM nodes) rather than loaded ones (~11,700). Adoption verifies content
  per chat for exactly this reason, and warns about empty chats rather than counting them.

Beware one asymmetry when reading results: workspaces above the deck cap are evicted and re-mounted
cold, while chats above the stream-buffer cap of 12 lose their tail buffer and re-fetch. A corpus
dimensioned below either cap measures neither.

Two things about the surface itself, both of which make a naive reading wrong:

- **The transcript is virtualized** (`agent-chat-scroll-web-dom-virtualized`), so a chat renders only
  its visible window - its node count is set by viewport size, not by the messages behind it. Read
  `dom.nodes` as cost per mounted chat; a flat series is virtualization working, not history being
  free. It is still the fastest check that a corpus is real: one workspace with loaded chats measured
  **~11,700 nodes against ~2,600 when the same chats were empty**, so a suspiciously low node count
  means the transcripts are gone, not that rendering got cheap.
- **Chats are tabs, and the strip overflows.** Past a handful, the rest are reachable only through
  `workspace-tab-overflow-trigger`, so a harness that walks only the visible strip measures the same
  four chats repeatedly while appearing to cover twelve. Wait on the target tab's `aria-selected`
  rather than on `agent-chat-scroll`: that container belongs to whichever chat is showing and stays
  visible across a switch, so waiting on it returns instantly and reports every switch as free.

**In production** - Settings › Diagnostics › Run app diagnostic, and copy. The `Client resources`,
`Client frame drift`, `Client growth ranking`, `Daemon traffic` and `Query cache hotspots` sections
are all in the same paste as the daemon's.

## Known properties of the client (as measured)

These are the structural facts the instrument has established. They are properties of the code as it
stands, not a status report - what is being done about them is a row in
[`projects/README.md`](../projects/README.md#performance), and the evidence, method and dated
numbers are in [`findings/client-performance/`](../findings/README.md) - the
[FPS-degradation report](../findings/client-performance/2026-07-25-fps-degradation.md) and the
[workspace-tree retention report](../findings/client-performance/2026-07-25-workspace-tree-retention.md)
that corrects its first conclusion.

- **Mounted workspace trees are evicted, LRU, at a user-set limit.**
  `pruneMountedWorkspaceSelections` in `screens/workspace/workspace-deck-retention.ts` keeps the
  active workspace plus the most recently active others and fully unmounts the rest. Unmounting
  releases the tree's `useQuery` observers - measured, with the released queries showing up as
  `query.unobserved`. **The cost of a session is a function of the limit, not of how many workspaces
  it has touched.** Marginal cost of one resident tree is +59 to +118 observers and +76 to +169 DOM
  nodes, the range depending on what that workspace has open.
- **The limit is `mountedWorkspaceLimit`, device-local, default 5** (Settings › General ›
  _Workspaces kept loaded_; clamped to 2–12). Device-local because retention is a property of this
  machine's memory and this user's habits, not of the project or the host. **The pure retention
  module holds no default of its own** - `maxMountedWorkspaces` is a required argument. A fallback
  constant there would be a second cap that can silently disagree with the one in Settings, which is
  how a user-facing setting stops meaning anything.
- **Set below the working set, the limit is worse than either extreme.** With four workspaces in
  rotation and a limit of three, every switch evicts the tree the user is about to return to -
  textbook LRU thrashing. This is why the default is 5 rather than a rounder 3 or 4: it covers a
  four-workspace rotation with one spare. Raising it costs memory, not frame rate - 3 → 6 resident
  trees was within run-to-run noise on every frame metric the soak can read.
- **Tabs inside a pane are evicted the same way, at `mountedTabLimit`.** `useMountedTabSet` keeps
  the frontmost tab plus the most recently visited others mounted (parked at `display: none` by
  `RetainedPanel`) and unmounts the rest. The setting is device-local and defaults to **match this
  device**: 6 on a desktop-class machine, 3 on a compact form factor, resolved by
  `resolveMountedTabLimit` in `screens/workspace/mounted-tab-retention.ts` (Settings › General ›
  _Tabs kept loaded_; an explicit number is clamped to 2–12). It was a hard-coded 3 for every device
  until it became a setting.
  - **An explicit choice is honoured on every device.** The form factor picks the default only.
    Narrowing a number the user typed would make the setting a suggestion, and they are the one who
    knows what their machine has.
  - **Evicting a tab is far more expensive than retaining one**, which is why the floor is 2 and why
    the desktop default moved up. A retained tab costs memory and almost no CPU (every reader of the
    stream buffers freezes while hidden - see [chat-lifecycle.md](chat-lifecycle.md)). Remounting one
    rebuilds the entire transcript - render model, layout, markdown, syntax highlighting - in a
    single blocking render, plus a timeline refetch if its stream buffers were released meanwhile.
- **Navigation asks the daemon for one thing per workspace visited, and nothing per revisit.**
  Returning to a workspace used to re-issue `fetch_agent_timeline`, re-ask for setup status, and
  re-subscribe terminals, none of which had changed. The three invariants that keep it at the floor:
  a chat pane fetches its timeline on focus **only** when history was never applied or the host
  reconnected since that agent last synced (`shouldSyncAgentTimelineOnFocus` - live `agent_stream`
  plus the reducer's seq/epoch gate covers everything else); a successful setup-status response
  carrying no snapshot is **an answer**, cached until a progress push, a workspace removal or a
  reconnect; and the terminals push subscription outlives its last observer by
  `TERMINAL_SUBSCRIPTION_LINGER_MS`, so a workspace round-trip is a timer cancel rather than an
  unsubscribe/subscribe pair. That last one is a **debounce on churn, not a retention policy** -
  keep it short enough that it never becomes a second answer to "how long do we keep workspace state
  alive", which belongs to the deck's mounted set.
- **`agentStreamTail` / `agentStreamHead` are released when an agent leaves the working set.** The
  rule lives in `timeline/agent-stream-retention.ts`: buffers go when the agent is not being
  displayed AND either it has left the session (deleted, removed, archived) or it is past the
  retention cap, oldest-touched first. Two parts are load-bearing and easy to break:
  - **"Not being displayed" is explicit, never inferred.** Every surface that renders the buffers
    registers a ref-counted retainer while mounted (`useAgentStreamRetention`). A mounted background
    pane is invisible to focus and to lifecycle, so inferring from either blanks it.
  - **Releasing the buffers must release the resume state with them.** `agentTimelineCursor` and
    `agentAuthoritativeHistoryApplied` are what tell `planInitialAgentTimelineSync` the client is
    caught up. Drop the buffers alone and the next open issues an `after` catch-up that returns
    nothing onto an empty tail - a blank chat. `releaseAgentStreams` does both; do not split it.

  The Visualizer is unaffected by eviction: its backfill-and-replay re-fetches from the daemon
  (`fetchAgentTimeline`), not from these buffers.

- **The timer counters are the fastest "not this" in the toolkit.** `runtime.liveIntervals` staying
  flat retires the timer-leak hypothesis at a glance, and it has stayed flat in every run so far.
