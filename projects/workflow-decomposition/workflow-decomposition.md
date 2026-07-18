# Workflow decomposition

**Status:** **Path B built + live-verified (2026-07-16, uncommitted).** A real 3-agent Sonnet-5 ultracode run decomposed into a `Workflow: rgb-fanout` observed row with three nested child rows (RED/BLUE/GREEN, each titled by its prompt, settled to idle) via `fetch_agents` — no projection errors. Path A ruled out empirically (below). Follow-ups remain (see end).

Claude Code's **Workflow** tool (deterministic multi-agent orchestration — `agent()` / `parallel()` / `pipeline()`, and the "ultracode" keyword's standing fan-out) surfaces in Otto today as a **single opaque observed-subagent row** titled `Workflow: <meta.name>`. The `agent()` fan-out it spawns internally — often a dozen-plus agents — is invisible: no per-agent rows, no per-agent nodes in the Visualizer, no per-agent tokens/liveness/failure. This charter promotes each internal workflow agent to a first-class, separately-watchable **observed subagent**, reusing the [observed-subagents](../observed-subagents/observed-subagents.md) track/pane/visualizer pipeline end-to-end (nothing here is workflow-specific downstream of the daemon adapter).

Read [observed-subagents.md](../observed-subagents/observed-subagents.md) first — it defines the observed-subagent model, the `attend: "observed"` read-only contract, and the projection this feature feeds. The single-row Workflow handling already there (recognized via `task_type: "local_workflow"` / `workflow_name` / cached `Workflow` tool) is the thing we deepen.

---

## What the investigation established (2026-07-16)

A 4-agent recon fan-out (itself an ultracode run — dogfooded) plus direct disk forensics settled the landscape:

### Detection is already solved

`isClaudeWorkflowTaskType` / `isClaudeWorkflowToolName` (`providers/claude/agent.ts`) already recognize a workflow three ways and register it under the Workflow `tool_use` id (`workflowObservedKeys`). Nothing to add for detection.

### The workflow persists a whole subsystem on disk (the key discovery)

Beyond ordinary Task fan-out, each Workflow run writes, under `~/.claude/projects/<project>/<session>/`:

```
workflows/wf_<id>.json                 run-state: script, args, phases, workflowProgress,
                                        totalTokens, totalToolCalls, status, error, defaultModel
workflows/scripts/<name>-wf_<id>.js    the workflow script source (export const meta {...})
subagents/workflows/wf_<id>/
  agent-<id>.jsonl + .meta.json         EACH internal agent — agentType:"workflow-subagent"
  journal.jsonl                         deterministic started/result journal, content-hash keyed
```

Three real archived runs were found in this repo's session data (`deep-research` killed @323k tokens, `map-otto-browser-tab-plumbing` completed @250k, plus the recon run). **Each internal agent's full transcript is already persisted, separately, per run — including for archived runs.** This is the material a disk-backed decomposition would read.

### The live SDK task\_\* stream is NOT persisted

Zero `workflow_name` / `"subtype":"task_started"` anywhere in the transcripts. The live `task_started` / `task_progress` / `task_notification` control-plane stream (what Otto's provider consumes live) is ephemeral. Otto's observed rows are ephemeral projections too. So an **archived** run kept the per-agent transcripts but lost the workflow→agent _linkage as seen on the wire_.

### Attribution collapses today, by design

Every streamed sidechain message is attributed by `parent_tool_use_id`, and all of a workflow's internal-agent messages carry the **single** Workflow `tool_use` id — so `ClaudeSidechainTracker` accretes them into one `SubAgentActivityState` → one row. Deliberate: see the `agent.ts` comment "keyed by the Workflow tool_use id, so its sidechain transcript lands on the same row."

---

## Two paths

### Path A — live re-keying (preferred if the capture passes)

Split the one Workflow row into one observed row per internal agent, from the **live** stream. This is a re-keying change at the sidechain-attribution seam — **no protocol change** (`observed_subagent_updated` already carries `key` + optional `parentKey`):

1. In `translateMessageToEvents`, when `parentToolUseId ∈ workflowObservedKeys`, derive a composite key `${workflowKey}::${discriminator}` from the message's own `subagent_type` / `task_description` (fall back to the plain workflow key when absent) and pass **that** to `appendObservedSubagentSidechainEvents` + `sidechainTracker.handleMessage`.
2. On first sight of a composite key, emit `observed_subagent_updated` with `parentKey: workflowKey` (reuse `observedParentKeyByToolUseId` — the exact nesting primitive already built for nested Task fan-out) so the per-agent row parents under the Workflow row.
3. `ClaudeSidechainTracker` needs no structural change — it keys by whatever string it is handed.

The track, pane, and Visualizer tree-rendering then light up for free (the Visualizer already renders `parentKey` nesting; per-row tokens/liveness from [subagent-liveness](../subagent-liveness/subagent-liveness.md) apply per agent).

**Blocked on one runtime fact** — the live stream must carry per-internal-agent identity. See "The gating capture" below.

### Path B (upgraded) — disk-tailing

If the live stream collapses (Path A fails), tail `subagents/workflows/wf_<id>/` as `agent-<id>.jsonl` + `.meta.json` files appear, and read `journal.jsonl` for started/result linkage, emitting the same `observed_subagent_updated` + timeline events per internal agent onto the identical downstream pipeline. Strictly more capable in one dimension: it can **also rebuild archived runs on demand** (the per-agent transcripts + journal are all still there), which the live-only path cannot. More code (a filesystem watcher + jsonl reader), and it duplicates identity the daemon otherwise gets for free — so it's the fallback, not the default.

Decision rule: **run the capture; if PASS, build Path A; if FAIL, build Path B.** Either way the daemon adapter is the only workflow-aware code — projection/protocol/client/visualizer are untouched.

---

## The gating capture

The probe is wired: `OTTO_DEBUG_WORKFLOW`-gated log in `logRawMessage` (`providers/claude/agent.ts`), a standing diagnostic (see [docs/visualizer.md](../../docs/visualizer.md) Debugging item 8). Runbook (minimal 2-agent workflow, a few cents): `scratchpad/pathA-capture-runbook.md`.

**PASS (build Path A)** if, within one run: among sidechain messages with `parent_tool_use_id == <Workflow tool_use id>`, `subagent_type` **or** `task_description` takes ≥2 distinct non-empty values; **or** ≥2 `task_started` arrive with distinct `task_id` each with its own `tool_use_id`.

**FAIL (build Path B)** if `parent_tool_use_id` is constant, message-level `subagent_type`/`task_description` are empty/identical, and no per-agent `task_started` with a distinct `task_id` appears.

**Gotcha:** the probe lives in server source, so the test workflow must run against the **dev** daemon (not a packaged one), and the dev daemon can't share port 6868 with a running production daemon — otherwise the workflow hits the uninstrumented daemon and logs nothing.

### Verdict — captured 2026-07-16 (FAIL → Path B)

Ran a real `two-color-agents` Workflow (RED/BLUE, 2 internal agents) on **claude-sonnet-5 + `--thinking ultracode`** against the instrumented daemon. Findings:

- **Sonnet 5 + ultracode engages the Workflow tool** — the run produced a genuine `task_started` `task_type: "local_workflow"` `workflow_name: "two-color-agents"`. (Also confirmed the Workflow tool only surfaces under the `ultracode` thinking option, id `CLAUDE_ULTRACODE_THINKING_OPTION_ID`; a plain run without it just answers inline.)
- **Path A FAILS.** Across all 57 captured SDK messages for the parent agent: **0 sidechain messages, 0 non-null `subagent_type`, 0 non-null `parent_tool_use_id`, exactly 1 `task_id`** (`wfu5c9b3q`, the workflow's own). The whole run was `1 task_started` + `5 task_progress` + `1 task_notification`, all on the single workflow task/tool_use id. The internal agents emit **no** per-agent identity on the live stream — the workflow is an opaque background engine to the parent SDK query.
- **Path B CONFIRMED.** The same run wrote, live, `subagents/workflows/wf_5c690058-062/` with **two** `agent-<id>.jsonl` + `.meta.json` (one per internal agent) and a `journal.jsonl` of 2 `started` + 2 `result` entries. Every piece Path B needs is on disk, in real time.

**Decision: build Path B (disk-tailing).** Path A is not recoverable from the stream and needs no further investigation.

---

## Ultracode cost (context for anyone running the capture or the feature)

- **Sonnet 5 is ultracode-capable in Otto** — `model-manifest.ts` gives `claude-sonnet-5` the full xhigh effort set and surfaces the "Ultra Code" option, same as Opus. Caveat: the SDK docstring marks xhigh as natively Fable/Opus-only ("falls back to high elsewhere"), and effort silently downgrades per model — so Otto sends `xhigh` but the CLI may run Sonnet at `high`.
- **Internal `agent()` calls inherit the parent session model** (`AgentDefinition.model` defaults to `inherit`). So _parent on Sonnet 5 + Ultra Code_ runs the whole fan-out on Sonnet, not Opus — the main cost lever. Per-internal-agent model/effort overrides exist only inside a workflow _script_, not as an Otto UI knob. You cannot get "ultracode but cheaper effort" — engaging ultracode forces `xhigh`; the only cheapening is the model.
- Ultracode fan-outs are genuinely expensive (the trivial 4-agent recon spent 328k tokens); the capture deliberately uses a 2-agent workflow.

---

## Path B implementation spec

**Framing (locked by the fork owner):** this is **a new, unconventional way to notify Otto of activity** — a synthetic event source that reads the on-disk workflow transcripts and re-emits Otto's **existing** event structure, so the rest of the system ingests it _as if it were a live SDK stream_. The goal is to reuse the current UI (subagents track + visualizer + metrics) **exactly**, with at most small exceptions. Where the live tail can't produce a datum, the **completion report** (`wf_<id>.json` + `journal.jsonl` results) backfills it (final tokens, tool counts, thoughts, per-agent results). The bar: make the synthetic stream carry as much detail as a real one, so the visualizer and metrics behave identically.

### Component: `WorkflowTranscriptSource` (daemon, Claude provider)

A per-workflow-run object owned by the Claude provider. Lifecycle bound to the workflow observed row we already create:

- **Arm** when `appendTaskStartedEvents` sees `task_type: "local_workflow"` (we already add `message.tool_use_id` to `workflowObservedKeys`). Pass it the workflow observed **key** (the parent for every child), the parent `this.agentId`, `this.claudeSessionId`, and the agent cwd.
- **Disarm** on the matching `task_notification` (completed/failed/stopped), on interrupt teardown, and in the turn-end observed sweep (the same three teardown sites the workflow row already settles at).

Responsibilities:

1. **Resolve + bind the on-disk dir.** Base `~/.claude` (honor `CLAUDE_CONFIG_DIR`), `projectKey` from cwd, `sessionId` from the live session. The SDK `task_id` ≠ the on-disk `wf_<runId>` dir name, so bind by watching `<session>/subagents/workflows/` for the newest `wf_*` dir created after arm-time; confirm later via the `taskId` field in `wf_<id>.json`.
2. **Watch + incrementally tail** `journal.jsonl` and each `agent-<id>.jsonl` — reuse the `artifact-watcher.ts` `fs.watch` + polling-fallback pattern, a per-file byte-offset cursor (parse only appended lines), and a ~200ms coalesce (match the visualizer adapter tick).
3. **Emit the existing events** onto the same provider `AgentStreamEvent` stream the live observed path uses — no new event types:
   - `journal` `started` for agent `X` → `observed_subagent_updated { key: "${workflowKey}::${agentId}", parentKey: workflowKey, status: "running", subAgentType/description from meta.json + the transcript's first user message }`. Nests the child under the workflow row via the existing `parentKey` → `PARENT_AGENT_ID_LABEL` mechanism.
   - each new `agent-<id>.jsonl` message → `observed_subagent_timeline` items via the **existing** Claude message→`AgentTimelineItem` mappers (assistant text/thinking → message items; tool_use → running tool_call; tool_result → terminal settle; `message.usage` → `cumulativeTokens`).
   - `journal` `result` for agent `X` → `observed_subagent_updated { status: "idle" | "error" }` (+ `requiresAttention` on failure — the "ran out mid-fan-out" case).
4. **Completion reconcile** from `wf_<id>.json` on disarm: authoritative per-agent `totalTokens`/`toolCalls`/final `resultPreview`/`state` and the workflow-level rollup — a final `observed_subagent_updated` per child to correct anything the live tail approximated, plus (future) phase grouping from `phases`/`workflowProgress`.

### What stays untouched

Protocol, `AgentManager` observed projection, the subagents track, the read-only pane, and the visualizer adapter are **unchanged** — they already consume `observed_subagent_updated`/`observed_subagent_timeline` and render `parentKey` nesting. This feature only adds a new _producer_ of those events. (Small expected exceptions: the child rows are `attend:"observed"` read-only like today; ensure `ensureObservedTimelineState` runs for each synthetic child id or appends throw.)

### Known constraints from the capture

- Live source = the transcripts (append-driven); the `wf_<id>.json` rollup is **end-only**, so live aggregate metrics are **derived** from per-agent transcripts and only _reconciled_ against the rollup at completion.
- Verify the one open cadence assumption: `agent-<id>.jsonl` is flushed incrementally during long agents (high confidence — Claude writes transcripts line-by-line — but confirm on a longer run).

---

## What shipped (Path B)

Daemon-only, Claude provider. Reuses the entire observed-subagents → track/pane/visualizer pipeline unchanged; only a new _producer_ of `observed_subagent_updated` / `observed_subagent_timeline` events was added.

- `workflow-transcript-mapper.ts` — `WorkflowSubagentTranscriptMapper`: on-disk transcript JSONL line → `AgentTimelineItem[]`, reusing the exported `mapClaude*ToolCall` mappers (byte-identical tool_call detail) + a self-contained envelope/block router (no `agent.ts` import ⇒ no cycle). 7 unit tests.
- `workflow-transcript-watcher.ts` — `WorkflowTranscriptWatcher`: byte-offset incremental JSONL tail + 700ms poll (armed only while a workflow runs), arm-time→newest-`wf_*`-dir binding, per-agent announce (nested under the workflow row via `parentKey`, titled by prompt since `workflow-subagent` agentType is treated as generic), live timeline + approximate token stream, journal `result` → idle, and a completion reconcile from `wf_<runId>.json` (authoritative tokens + final state). 2 integration tests (temp dir + fake timers).
- `agent.ts` — armed in `appendTaskStartedEvents` (workflow detect), disarmed in `appendTaskNotificationEvents` (settle), `flushPendingToolCalls` (interrupt), and `close()`. Emits via the existing `pushEvent` → `notifySubscribers` path, so synthetic events flow through the identical projection as live ones. Turn-end sweep left alone (workflows are exempt). `OTTO_DEBUG_WORKFLOW` probe promoted to a standing diagnostic; watcher logs child announce/settle at debug.

**Live-verified end to end:** Sonnet-5 + `--thinking ultracode`, 3-agent RGB workflow → `fetch_agents` showed `Workflow: rgb-fanout` + 3 nested children with per-prompt titles, all settled idle; daemon log clean (no `Unknown agent` timeline throws).

## Follow-ups (not yet done)

1. **Commit** — all uncommitted in the working tree.
2. **Direct UI screenshot** — verified via `fetch_agents` (the app's own data source) + clean projection; a track/visualizer screenshot is the remaining manual confirmation.
3. **Nicer titles** — live title is the prompt (the pretty script `label` in `wf_<id>.json` is end-only + the row title is frozen at first announce). Acceptable; revisit if desired.
4. **Phase grouping** — `phases` / `workflow_phase` are read but not yet surfaced as track/visualizer grouping (open question 4).
5. **Archived-run rebuild** — the reconcile reads on-disk state, so a "reconstruct this archived workflow" action is now cheap to add (open question 3).
6. **Per-agent error granularity** — live settle is idle; individual failure is only surfaced via the run-state `state` at reconcile. A failing-agent live signal (transcript-level) is a later refinement.
7. **Fold in** — once committed + soaked, retire this charter into [observed-subagents.md](../observed-subagents/observed-subagents.md) / [docs/visualizer.md](../../docs/visualizer.md).

---

## Open questions

1. **Nested workflow agents** (an internal `agent()` that itself fans out / a nested `workflow()`): flatten under the workflow row, or preserve depth via the existing `observedParentKeyByToolUseId` chain? Leaning: preserve depth — the primitive already exists.
2. **Track density** — a dozen-plus internal agents per run; do they need eager auto-collapse of completed children sooner than the existing tidy rule?
3. **Archived-run rebuild** — if Path B ships, do we expose "reconstruct this archived workflow" as a user action, or keep it live-only for parity with the ephemeral observed model?
4. **Workflow phases** — `wf_<id>.json` carries `phases` / `workflowProgress`; surface phase grouping in the track/visualizer, or keep it a flat child set for v1?

## SDK note — native session-store APIs (added 2026-07-17)

Claude Agent SDK ≥ 0.3.212 grew surface that overlaps Path B's hand-rolled transcript tailing:
`getSubagentMessages(sessionId, agentId)` / `listSubagents(sessionId)`, and `SessionMessage`
now carries `parent_agent_id` (nesting parentage; null for depth-1/main). These are poll-style
read APIs, not a push stream, so they don't replace the live watcher outright — but evaluate
(a) replacing the watcher's JSONL parsing with `getSubagentMessages` per discovered agent, and
(b) using `parent_agent_id` instead of inferred parentage. Keep the watcher shape for any
provider without session-store APIs.
