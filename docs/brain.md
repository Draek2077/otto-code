# Otto Brain

`@otto-code/brain` hosts local GGUF models on llama.cpp's `llama-server`. This page documents the
part Otto talks to: the brain's management API, how the daemon proxies it, and where each capability
surfaces in the app.

For the package's own architecture (runtime resolution, the DLL-stub trap, the calibration and sweep
algorithms) read [`packages/brain/CLAUDE.md`](../packages/brain/CLAUDE.md). It carries empirical facts
that must survive edits.

Navigation: [Documentation index](README.md) · [Providers](providers.md) ·
[Token economy](token-economy.md)

## The two surfaces

Brain work is split across two places in the app, and the split is deliberate.

| Surface                     | Holds                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain page** (`/brain`)   | Everything operational: live status, the model library, model profiles and Prompt & template profiles, the VRAM budget, downloads, calibrate, sweep, benchmarks, logs |
| **Settings → Host → Brain** | Setup only: local or remote mode, host and port, default model and lock, auth, TLS, sharing, remote configuration, and start/stop/restart                             |

The rule is that **operations are work, not settings**. Downloading a model, calibrating VRAM and
running a benchmark are long-running, progress-bearing and result-producing. They do not belong next
to a TLS certificate path, and burying them there is what made them hard to find.

## One resident-model queue

Brain currently has one resident `llama-server`, so it has one scheduler for all model-targeted
work. API completions, calibration, sweep, and benchmark jobs enter the same queue with their
resolved target model. A job waits for the current turn to drain, the scheduler unloads the old model
when necessary, loads its target, runs the full operation, and then selects the next queued turn.

Calibration, sweep, and benchmark jobs are exclusive turns. Completion requests for the resident
model still use its configured parallel slots, but no completion can run beside a tuning or benchmark
operation. A calibration or sweep deliberately does not restore the model that was resident before it
started: doing so would jump ahead of the next queued request.

The Models table mirrors that queue. A dot means a model is loaded and idle; a spinner identifies
loading, unloading, or queued work; and the play marker identifies the model currently serving work.
The job row names queued work before it begins, rather than implying that it is already using the GPU.

The Brain page is reached from the Brain icon in the bottom-left icon rail. It is a top-level route
outside any workspace, because a brain belongs to a host, not to a project.

## Agent compaction

Otto Brain uses the daemon-owned OpenAI-compatible compactor, with local-model defaults chosen to
release context decisively: it retains the newest 6,000 conversation tokens verbatim and caps the
generated handoff summary at 4,000 tokens. The compactor preserves the active goal, constraints,
decisions, changed files, commands and errors, and next steps, without treating a detailed transcript
as the product. These are provider defaults: an `otto-brain` provider override may set
`compaction.keepRecentTokens` or `compaction.summaryMaxTokens` when a model needs a different
tradeoff.

When Brain is disabled in Settings → Host → Brain, its rail icon stays grey and its tooltip reads
"Brain - Disabled". Selecting it opens that host's Brain settings section so the owner can enable it.

## The management API

The brain serves its own management surface at `/__host/*`. Its header comment states the intent:
"the single API both the TUI and Otto's GUI consume, so the two never drift."

| Route                                       | Does                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /__host/status`                        | Liveness, model, telemetry, scheduler, and `capabilities`                   |
| `GET /__host/status?resources=1`            | The above plus live CPU, RAM and GPU telemetry                              |
| `GET /__host/events`                        | SSE: a complete cheap status snapshot every time the brain's state moves    |
| `GET /__host/capabilities`                  | What this brain can serve, as flat booleans                                 |
| `GET /__host/config`, `POST /__host/config` | The brain's own effective config; the write is gated on `allowRemoteConfig` |
| `GET /__host/evals`                         | Benchmark rankings, latest results and variance                             |
| `GET /__host/jobs`                          | Active and recent host-owned benchmark jobs                                 |
| `POST /__host/jobs/bench`                   | Start a benchmark on this brain's machine                                   |
| `POST /__host/jobs/cancel`                  | Cancel a host-owned benchmark job                                           |
| `POST /__host/restart`                      | Restart the managed brain after acknowledging the caller                    |
| `GET /__host/models`                        | The joined model inventory plus disk usage                                  |
| `GET /__host/model?id=`                     | One inventory row                                                           |
| `GET /__host/model/fields?id=`              | The editable field descriptors                                              |
| `GET`/`POST /__host/model/profile?id=`      | Read and write a model profile                                              |
| `GET /__host/model/budget?id=&…`            | The VRAM budget for a hypothetical model profile                            |
| `POST /__host/model/load?id=`               | Load a model into the running brain                                         |
| `POST /__host/model/unload`                 | Stop the resident model                                                     |
| `DELETE /__host/model?id=`                  | Delete a model's files                                                      |
| `GET /__host/logs?limit=N`                  | Tail the current Brain service log: every managed child and host operation  |

### Model ids are query parameters, not path segments

A model's id is its path relative to the models directory, so it contains slashes. Encoding those as
`%2F` inside a path is exactly the thing an intermediary silently normalises, and the resulting
failure reads as "model not found" rather than as a routing bug. Model-scoped routes therefore take
`?id=`.

### Resources are opt-in

`/__host/status` is also the daemon's liveness poll, and it runs far more often than any UI. Live
resource telemetry costs an `nvidia-smi` spawn, so it is only gathered when the caller asks with
`?resources=1`. Slot activity stays in the cheap status because the rail and live inference panel
need it. Only the Brain page's Overview tab, which actually renders the resource numbers, opts in.

### Status is published, not polled

The brain owns its own state, so it publishes it. `GET /__host/events` is an authenticated SSE
stream over the same endpoint, token and TLS policy as every other `/__host/*` route, and each
`event: status` carries a **complete** cheap status snapshot.

The pieces, and why each is the way it is:

- **The daemon opens one stream per configured brain, never one per connected client.** It reads the
  ordinary `/__host/status` once to get a baseline, checks `capabilities.events`, and only then
  connects. That order is the compatibility contract: a brain too old to have heard of events
  answers the first half exactly as it always did and is simply never asked for the second.
- **Snapshots are complete, never deltas.** A missed event and a reconnect are then the same,
  idempotent recovery on both sides. It also means a consumer overwrites its cached status whole;
  merging would keep a `lastError` alive after the brain had cleared it.
- **The brain coalesces, and a timer tick is not an event.** `service/status-events.ts` keeps the
  snapshot that would be sent and compares only the fields worth waking a UI for. Traffic totals,
  the log line count and slot context capacity cannot trigger one. Live slot counters and rates can,
  but only from the publisher's bounded 250 ms sample, never from the model's token loop. The
  supervisor state machine, scheduler queue and inference stages notify directly; `activity` and
  slot performance are sampled because one is a file another process writes and the other is a
  loopback read.
- **Nothing samples while nobody is listening**, on either side. The brain's publisher runs no timer
  without a subscriber, and the daemon holds no stream without a fan-out listener wired.
- **A dropped stream is a reachability transition.** The daemon re-probes, publishes whatever is
  actually true (a brain that came back, or an unreachable one), and reconnects with bounded
  backoff. The brain writes an SSE comment every 20s so an idle stream is not mistaken for a dead
  one, and it ends its streams on shutdown, since `server.close()` waits on open connections.
- **`resources` is never pushed.** It spawns `nvidia-smi`; see "Resources are opt-in" above. The
  Overview tab keeps pulling it.

The daemon rebroadcasts each snapshot to its clients as a `brain_status_changed` status message,
scoped by the delivering connection's `serverId` so two connected hosts cannot overwrite each
other's brain state. `data/brain-status.ts` writes it into the one cache entry every Brain surface
reads, and reconnect repair invalidates that entry once.

## Why the daemon proxies rather than shells out

The daemon reaches the brain two different ways, and which one a capability uses decides whether a
**remote** brain can have it.

**Host-owned operations.** Calibrate, sweep and benchmark execute inside the Brain service against
its one resident `Supervisor`. They never create an independent `llama-server`, alternate port or
unobserved log buffer. The service reports their progress as jobs and appends operation markers to
the same bounded log tail as `llama-server` output.

llama.cpp applies context size and reasoning budget at launch. Calibration and sweep therefore
transition that one resident supervisor between their measurement configurations, then restore the
previous loaded model and model profile. This is a controlled reload in one hosted lane, not a second server.
Benchmark runs against the resident supervisor directly and leaves its selected model loaded.

**HTTP proxy (`BrainManager`).** Forwards to the brain's `/__host/*`. `BrainManager` already resolves
its endpoint by mode, so the same call reaches a local child or a remote host with no branch on
either side.

Everything added for the Brain page uses the proxy. That is the whole reason a remote brain gets the
model inventory, the model-profile editor, the VRAM budget, load, unload, delete and logs at all, rather
than being permanently limited to status and evals.

**Host-owned jobs.** The daemon proxies start, list and cancel calls to the Brain host for local and
remote modes alike. A benchmark, calibration, or sweep therefore uses the selected host's model
store, GPU, results directory and resident `llama-server`; it can never fall back to the connecting
machine. The `jobs` capability keeps older brains read-only.

**Remote restart.** A brain that advertises `capabilities.restart` accepts `POST /__host/restart`
only when remote configuration is enabled. It acknowledges the request before gracefully exiting;
the owning daemon restarts its managed child. A proxy exposes this as the ordinary restart control,
while start and stop remain hidden because they belong to the owning daemon.

**Do not add new capabilities to the shell-out path.** A capability built there needs a second
implementation before remote can have it, which is how the two drift.

## Capability negotiation

Two versions move independently: the daemon (does it know how to proxy?) and the brain (does it serve
the route?). A current daemon can be pointed at an older brain.

1. The brain reports `capabilities` **inline on `/__host/status`**. Not from a separate
   `/__host/capabilities` fetch, even though that route exists for direct callers: the daemon polls
   status constantly, and a separately cached copy would go stale the moment the owner toggles
   `allowRemoteConfig`, which is what `capabilities.writable` reflects. `restart` is additive, so
   older brains simply do not offer the restart control through a proxy.
2. The daemon passes that through on `brain.host.status` and advertises
   `server_info.features.brainConsole` when it knows how to proxy the routes.
3. `capabilities` carries additive `events` and `liveInference` flags, and status carries an additive
   `apiVersion`. Both
   default to absent, so an older brain reads as "no event stream" rather than as broken. Unknown
   capability names and unknown status fields are kept, not dropped: the brain can grow a feature
   without a daemon upgrade, and the daemon can grow one without a brain upgrade. No exact package
   version match is ever required.

Host API v2 adds `inference`, the exact aggregate count of requests in `processing`, `thinking` and
`generating`, plus bounded live `slots.threads` token counts and rates. The request stages come from
the proxy lifecycle, so they move before the next `/slots` sample and remain exact with parallel
requests. The slot sampler supplies engine-measured output counts and throughput. Current llama.cpp
nests its generated-token counter under `next_token`; the reader also accepts older top-level field
spellings so changing the selected runtime does not erase the live view.

The client reads `features.brainConsole` to decide whether the Brain page is offered at all, then
reads `status.capabilities` to decide which tabs are live. A brain too old for a capability shows
"Update the brain on this host." There is no fallback path and no degraded reimplementation, per the
feature contract in [`CLAUDE.md`](../CLAUDE.md).

**`features.brainStatusPush` is the one flag that is not a fixed daemon capability.** The daemon can
only push what the brain publishes, so it is true only while the _currently selected_ brain also
advertises `capabilities.events`, and the daemon rebroadcasts `server_info` when that flips. Pointing
the host at an older brain therefore walks the flag back down, and the client restores its status
poll. That poll is the explicit compatibility path, gated once at the query boundary rather than
branched through the surfaces that read the status.

## Write authorization

A brain is loopback-only until its owner opts in, and "can use this brain" does not imply "can
reconfigure it". `POST /__host/config` has always been refused with 403 unless `allowRemoteConfig` is
set. Every management write inherits that same gate:

| Endpoint                                               | Gate                             |
| ------------------------------------------------------ | -------------------------------- |
| Any `GET /__host/*`                                    | auth token                       |
| `POST /__host/model/profile`                           | auth token + `allowRemoteConfig` |
| `POST /__host/model/load`, `POST /__host/model/unload` | auth token + `allowRemoteConfig` |
| `DELETE /__host/model`                                 | auth token + `allowRemoteConfig` |

Deleting model files removes tens of gigabytes from someone else's disk. It does not get a weaker
gate than editing their default model.

The client reflects this: `capabilities.writable` is false when the far side has not opted in, and the
model-profile editor renders read-only rather than offering a Save that would 403.

## Model profiles

### Model bundles

A catalog entry is a bundle only when it declares companion components. The
primary GGUF remains required. Optional components, such as image
understanding projectors and speculative drafters, are selected independently
in the Library and are then enabled independently in the model profile. The
model profile stores stable component IDs only; the host derives every artifact path
from its catalog manifest and local inventory.

An unavailable component stays visibly unavailable and cannot be enabled. The
host never downloads it during launch. Plain text-only models have no bundle
controls and retain the ordinary model-profile flow.

Each enabled component is part of the launch argv, VRAM budget, and calibration
identity. A main-model-only calibration is historical data, not an exact
measurement of a projector- or drafter-enabled load. The current Supervisor
still owns one llama.cpp process, so this delivery does not claim concurrent
independent main models. A future process pool must reserve VRAM per process
and may not assume weights are shared across processes.

Each model carries a **Model profile**: its saved launch and VRAM settings. It is distinct from a
**Prompt & template profile**, which supplies message formatting and a system-prompt addendum.

| Field              | Effect                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| Context multiplier | YaRN extension factor: 1, 2, or 4 times the native context window        |
| Context            | The window, bounded by the model's limit and by VRAM                     |
| KV cache K, V      | Quantisation of the key and value caches; the main lever on KV size      |
| Flash attention    | Required for a quantised V cache                                         |
| Vision             | Load the paired projector; only available when the model has one         |
| Reasoning budget   | The cap on thinking tokens                                               |
| GPU layers         | How many layers go on the GPU; 999 means all                             |
| Parallel slots     | Concurrent requests, which share one KV pool                             |
| Cached KVs         | Chats whose KV state is parked in system RAM; 0 keeps the engine default  |

**Cached KVs sizes llama.cpp's prompt cache in chats, not megabytes.** When a chat loses its GPU
slot, `llama-server` can park its KV state in host RAM and copy it back when that chat returns,
instead of re-prefilling the whole conversation. The budget for that is `--cache-ram`, a size in MiB,
which is unusable as a setting because the size of one chat depends on the model's measured KV
bytes/token and on the per-slot context. Brain therefore stores a count and derives the flag:
`cachedChats x kvBytesPerToken x (contextSize / parallelSlots)`.

The warning prices that figure against installed RAM and is shown at every value, including the
Default of 0: `4.8G each becomes 28.8G of 61.6G.`, or at 0, `llama.cpp's own limit applies: about
8.0G of 61.6G.`, because 0 emits no flag and the engine then parks up to its own 8192 MiB default in
host RAM - not the same as caching nothing. The estimate turns yellow at half the machine's RAM and
red once it would use at least all of it.

The count is a floor, not a cap: it assumes every chat fills its whole window, and real conversations
rarely do, so more of them usually fit. A count above 0 is priced only from a measurement; the flag is
withheld when the model has no measured calibration, because the theoretical KV cost overestimates by
multiples, and a budget derived from it would reserve several times the RAM actually needed. The
warning names that case and asks for a calibration.

**Runtime log verbosity** is a host setting, not a model-profile field. It controls the resident
`llama-server` output that appears in Brain Logs: Generic output (0), Errors (1), Warnings (2),
Info (3, the default), Trace (4), or Debug (5). Changing it relaunches the loaded model.

**The ranges, the validator and the warnings live in exactly one module**,
`packages/brain/src/config/profile-edit.ts`, and the client renders its controls from the descriptors
that module sends. A client that invented its own limits would either offer a value the brain rejects
or hide one it accepts.

Three warnings are empirical and must survive edits:

- **A quantised V cache requires flash attention.** Without it `llama-server` will not allocate the
  cache and the model never reaches ready. This one blocks a load rather than merely advising.
- **An unrestricted reasoning budget (`-1`) is the failure this package exists to prevent.** Thinking
  models will spend an entire token allowance reasoning and return no content at all.
- **A changed VRAM input requires a new calibration.** See "The calibration verdict" below.

Only the supported model-profile keys are honoured on a write. `modelPath`, `mmprojPath` and `modelId` are re-derived
from the model on every read, so accepting them would be a lie at best and a path traversal at worst;
`extraArgs` is arbitrary process arguments and stays CLI-only.

### Prompt & template profiles

A **Prompt & template profile** is a named, Brain-owned record in one model-family bucket. It carries
a complete llama.cpp-compatible Jinja chat template, optional template kwargs, and an optional
system-prompt addendum. The Brain owns the record rather than the client, so local and remote clients
manage the same library and a selected template is materialized only when the model loads.

Each model profile chooses one of three modes:

| Mode      | Effect                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inherit` | Use the default Prompt & template profile for the model's family. If that family has no default, no profile is selected and llama.cpp uses the template embedded in the model. |
| `off`     | Always bypass Prompt & template profiles and use the template embedded in the model.                                                                                           |
| `custom`  | Use one named Prompt & template profile from the model's family.                                                                                                               |

Every family can name one default. Families come from the catalog when available, otherwise from GGUF
metadata. A model with no family belongs to the shared `generic` bucket. A default set for `generic`
therefore applies to every model that has no family, not to one otherwise unclassified model.

The router injects a selected system-prompt addendum into the parsed completion request body. It does
not splice it into the Jinja template. Template-side mutation of the messages list is not portable
across minja and Jinja2, each family handles its system turn differently, and multimodal message
content can be an array of parts rather than a string. Injection also preserves the agent's existing
system prompt. See the related Brain decision record for the request-ordering details.

The current protocol and persisted code identifiers retain the older `HostingProfile` name. They are
not documentation terms. Any rename needs the separately chartered compatibility migration; it must
remain additive until the protocol support window closes.

### Context multiplier

The **Context multiplier** is a YaRN RoPE extension factor of 1, 2, or 4. A value above 1 raises the
model profile's usable context ceiling to its native window multiplied by that factor. The field is
unavailable when the GGUF declares no native context window.

For an extended model, Brain launches llama.cpp with `--rope-scaling yarn`, `--rope-scale`,
`--yarn-orig-ctx`, and an `--override-kv <arch>.context_length` override using the selected context.
The VRAM budget uses the same native-times-multiplier ceiling, so it never recommends more context
than the selected extension permits.

YaRN extrapolates beyond the native context. Recalibrate before relying on an extended model profile.

### The calibration verdict

`calibrationRequired` is a durable verdict on the saved model profile. It begins true and is cleared
only by a successful calibration. A change to a setting that affects the KV cache system or the
evaluation sets it true again: context multiplier, KV cache K or V type, flash attention, vision, or
enabled components. Context size, GPU layers, parallel slots, and cached chats never set it: the calibration is a
differential measurement of KV bytes per token, so fixed terms (weights wherever they sit, CUDA
context, compute buffers) cancel out of the slope, and a context size or slot count the measurement
was taken at does not change what the measurement says.

A measurement from the previous shape remains stored for comparison, but it is not used as the
current VRAM budget while calibration is required. Brain uses the theoretical budget until a new
calibration succeeds. This is distinct from the warning that a measurement exists for other cache
types: that warning identifies why a cache-type-specific measurement is stale, while the calibration
verdict says the saved model profile itself has not been measured in its current shape.

## The VRAM budget

`weights + projector + KV + overhead` against usable VRAM, with a fit verdict. The client can ask for
the budget of a **hypothetical** model profile by passing the fields as query parameters, so the verdict
updates as a control is scrubbed without persisting a value the user is dragging past.

The KV figure comes from one of four places, and the UI says which:

| State         | Means                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| `measured`    | Calibrated on this exact model and cache types                                                |
| `inherited`   | Measured on a relative with the same attention geometry, rescaled to this model's layer count |
| `stale`       | A measurement exists, but for different cache types                                           |
| `theoretical` | The formula, which is a worst-case bound                                                      |

`inherited` is never presented as measured. The distinction matters because **the theoretical formula
overestimates badly** (roughly 4x on architectures that only keep a full cache on a subset of
layers), so calibrating usually _unlocks_ context rather than taking it away.

When a model profile requires calibration, Brain reports the theoretical budget even when a historical
measurement for the old model profile exists. `stale` remains the separate cache-type warning described above.

## A benchmark records what it was measured with

One JSON file per run under the brain's `results/`, and **every value the run was measured with goes
in it**. A bad score is far more often a bad setup than a bad model, and the difference is only ever
visible from the settings. None of it is recoverable after the fact, so it is written at save time.

`schema: 2` is the record that carries this. Schema 1 kept six model-profile fields and no setup block, so
readers must treat everything below as absent on an older run rather than assuming it. Those runs are
still perfectly good scores. They just cannot say what produced them.

| Block     | Carries                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `profile` | The whole model profile: context, KV cache types, flash attention, GPU layers, parallel slots, batch/ubatch, reasoning budget, extra args |
| `setup`   | The **llama-server argv**, the VRAM fit (requested vs effective context, and why), the KV source, and predicted VRAM against observed     |
| `suite`   | Which tasks graded it: standard or repo-mined, `--only`, concurrency, depths, and whether generated code was executed or only parsed      |
| `model`   | Identity plus GGUF geometry: native context length, layer count, KV head count                                                            |

The argv is the one that matters most. Every other field is a convenience; that array is the only
true statement of what ran, and it is what makes a run reproducible by hand.

Two fields exist purely because they are otherwise unrecoverable:

- **`setup.requestedContextSize`.** `fitToBudget` cuts a model profile's context down to whatever fits the
  GPU and runs anyway, which is right at load time and a silent lie afterwards. Without this, the
  record says a model scored 41% at 128k when it was really measured at 16k.
- **`setup.kvSource`.** A context chosen off the theoretical formula is a different measurement from
  one chosen off a calibration, even when the two numbers happen to land in the same place.

**`configKey` was deliberately not widened to include any of it.** That string is the grouping key
every stored run was written with. Widening it would not re-key history, it would split each model's
past runs from its future ones and quietly reset every variance figure on the page. New settings are
recorded as data, never folded into the key.

The Benchmarks tab reads this back as a diagnosis rather than a dump: a context cut to fit, a VRAM
budget nobody measured, layers left on the CPU, a context above the model's native window, a context
split across slots, or an unlimited reasoning budget each get named on the run they affected. The
checks live in one table in `benchmarks-tab.tsx`; a new known failure mode is a new entry there, not
a branch inside an existing one.

## The Brain page

Five tabs, on the `stats-screen.tsx` layout: a pinned header, a pinned toolbar holding the tabs, and
exactly one scroll region. A host picker appears only when more than one connected host has a brain.
State is per-host and never merged: two brains are two machines with their own GPUs and model stores.

| Tab            | Holds                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview**   | Status, lifecycle, installed runtime, VRAM, CPU/memory/GPU/slots, traffic counters including the reasoning-only warning                    |
| **Models**     | The model table, and a detail panel with metadata, the model-profile editor, the live budget, load, calibrate, sweep, delete               |
| **Library**    | The download catalog, Hugging Face search, and job progress                                                                                |
| **Benchmarks** | The leaderboard over the run list, and a detail pane that compares two runs; plus a way to run the suite                                   |
| **Logs**       | The current Brain service session: every managed process and operation in one append-only log, with each completed line pushed immediately |

Every current-session line has a source marker. **`[brain]`** identifies Brain-owned work and carries
one operation marker: **`[library]`** for catalog, Hugging Face, download and deletion work;
**`[model]`** for profile changes, load/unload, calibrate, sweep and benchmark work; **`[api]`** for
completion admission, queueing and dispatch; and **`[server]`** for service lifecycle. Raw child output
is marked **`[llama-server]`** after removing llama.cpp's repetitive elapsed-time, level and component
columns. Every row uses a compact `HH:mm:ss.SSS` session timestamp, and the Logs tab colors only the
source tags rather than the body of the message.

The model table and the leaderboard are **tables, not cards**: their whole job is comparison between
rows.

The Models tab reports model bytes against the brain host's total and free filesystem space. The
inventory comes from the brain itself, so these figures describe the same model store whether the
client reaches the owning daemon directly or through a remote-brain proxy.

The Benchmarks tab puts **two stacked tables on the left and one detail pane on the right**. The
leaderboard picks a model; the run list under it picks which of that model's runs to put beside the
newest one. The run list carries each run's spread stats, folded in from `evals.variance`, because a
spread answers "was this measurement typical" and that question is only ever asked about a specific
run. They used to sit in a separate full-width table, nowhere near the runs they judged.

**The right pane shows the latest run by default, and exactly two runs when one is selected.** That
is the shape of the question the page answers. Not "what did this model score", which the leaderboard
already said, but "what changed between the setup that scored 71% and the one that scored 43%". The
latest run is the fixed reference and is never swapped out by a selection, so both cards carry the
same sections in the same order and a difference is a horizontal glance rather than a memory test.
While comparing, the per-task table drops Weight and Time: each card has half the pane, and the score
is the column that answers the question. Picking the compared run again drops back to one card.

The point difference against the latest run sits **above** the pair, right-aligned, and its line is
reserved whether or not a comparison is open. Two reasons, both about keeping the cards in step: the
verdict is about both runs rather than belonging to one of them, and a line that lives inside the
selected card pushes that card's every section a row out of alignment with its twin. Reserving the
space means opening or dropping a comparison never shifts the cards vertically either.

Runs come from `evals.latest`, the most recent run per model+config. An earlier run of the same setup
is superseded, and showing it would invite a comparison between a measurement and the measurement
that replaced it.

## The rail button reports state

The Brain button on the bottom-left rail is the only always-visible surface the brain has, so it
carries a state machine rather than being a static glyph. A model loading, or a benchmark that owns
the machine for ten minutes, is exactly the sort of thing you need to see without going to look for
it. `components/brain/brain-state.ts` holds the states, the tints and the motion;
`use-brain-rail-state.ts` derives one from the host status.

The status it derives from arrives pushed (see "Status is published, not polled"), which is what
makes the button honest about a transition instead of a beat behind one. The rail, the workspace
title button and the Brain console share a single cache entry, so all three change together. One
thing the stream cannot cover: the brain's load and unload endpoints only answer once the work has
_finished_, so pressing Load applies a deliberately small optimistic `starting` to that shared entry
first. That is the UI predicting the state machine's next step, and it is never extended to the
inference states - an open request is not evidence a model is thinking.

For inference, host API v2 reports `processing` as soon as a request is dispatched to llama-server,
then moves it to `thinking` on the first reasoning delta and `generating` on the first content delta.
The rail prefers these direct lifecycle signals and uses the sampled prefill/decode split only as the
compatibility signal for older brains. The Overview composes every cheap push into its enriched
status cache while retaining its last CPU/GPU/RAM sample, so resource collection stays slow and
opt-in while model activity moves at event speed.

"Always visible" needs a second mount site, because the sidebar is collapsible on desktop and is a
closed overlay for most of a mobile session. `components/brain/workspace-brain-button.tsx` puts the
same live glyph in the workspace title bar, between the Visualizer button and Explorer, and renders
only while the sidebar is not showing its own, so the two are never on screen at once. It is pinned:
the responsive fit in `screens/workspace/compact-header-actions.ts` drops Voice cues, Visualizer,
Explorer and Play into the "..." menu as the row narrows, but never the Brain. A status light inside
a closed menu reports nothing, and the menu's leading-icon slot draws a flat glyph anyway, so the
animation that carries the whole signal would not survive the move. It is charged to that fit's fixed
chrome instead, so the four droppable buttons still spend an honest width budget.

Two rules hold it together, and both exist because the alternative produces an icon that lies.

**A state is only shown when a signal for it exists.** Several states were declared before the brain
could report them. `deriveBrainState` simply never returns those until the field lands, and the
visual layer needs no change when it does. Animating "thinking" because a request happens to be open
would be a guess, and a status light that guesses is worse than one that stays still.

**The button always reads as the brain.** Every state draws the same `network_intelligence` glyph, so
"where is the Brain page" never moves. Tint and motion carry most of the difference. Only a state
that has to be told apart at a glance gets its own mark.

| Kind         | States                                                     | How it reads                              |
| ------------ | ---------------------------------------------------------- | ----------------------------------------- |
| Lifecycle    | off, unreachable, idle, degraded, error                    | A flat tint, no motion                    |
| Work         | loading, unloading, queued, prefill, thinking, generating  | A gradient travels the glyph, plus a glow |
| Long-running | downloading, scanning, calibrating, sweeping, benchmarking | Amber, and its own mark                   |

Direction carries the meaning, because colour alone does not survive being 24px wide. Tokens coming
in sweep left to right and tokens going out sweep right to left; a model load fills from the bottom
and an unload drains from the top. Thinking has no throughput to depict, so its glow orbits instead:
motion without direction.

Two orderings in the derivation are load-bearing. A long-running op outranks every busy signal it
produces, because a benchmark loads models and runs completions through them, and deriving from the
raw signals would flicker the rail for the entire run. And `degraded` is checked last, so a brain
with a stale `lastError` that is nonetheless serving tokens reads as working rather than as broken.

### Badge geometry

Five states swap to another glyph in the `network_intelligence` family. Calibrate and sweep have no
variant in that family, so they keep the base brain and take a mark sitting in a round gap bitten out
of its lower right, which is how the family builds its own variants.

The gap is a real transparent knockout, never a disc painted in the surface colour. The rail button
has a hover fill behind it, and a painted disc would seam against it the moment the pointer landed.
One builder produces both the drawn artwork and the animation mask, so the gap cannot end up in one
and missing from the other.

The numbers live in the header of `brain-icon-glyphs.ts` and have two different authorities. The
badge's X centre and disc size are **measured** off `network_intelligence_history` and `_update` by
rasterising them at 960px, and should not be hand-edited. The Y centre and the gap radius are **tuned
by eye**, because the family does not punch a circle at all: they pull the brain back with a shaped
edge, so no single radius reproduces it. `brain-icon-geometry.test.ts` pins all of them against
accidental drift, not against deliberate change.

One trap worth knowing before adding a mark: Material glyphs ink only 800 of their 960 box, so a mark
drawn at the family's disc diameter renders about a sixth too small. `MARK_INK_RATIO` divides that
back out.

## The TUI still exists

`otto brain` opens the terminal UI, and it stays. It is the headless path and it works over SSH.

The Brain page exists because the TUI cannot be reached from the desktop app on Windows at all:
`Otto.exe` is a GUI-subsystem binary, so `stdin.isTTY` is false and `setRawMode` has no console to
switch. That is a property of the installer's Node host, not a PATH problem, and no launcher change
fixes it. See `packages/brain/CLAUDE.md` for the measurement.
