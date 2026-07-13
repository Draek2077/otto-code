# Subagents robustness & cleanup

**Status:** Charter — ready to execute. Drafted 2026-07-12 after the first tester's live run surfaced
bugs across both subagent kinds. Scope is a hardening + UX pass over the **existing** subagents
track/tab/pane, not a new subsystem. It touches both **observed subagents** (Claude `Task`/ultracode
fan-out — see [observed-subagents.md](../observed-subagents/observed-subagents.md)) and **Otto-native
subagents** (`create_agent` with `relationship.kind === "subagent"` — see
[../../docs/agent-lifecycle.md](../../docs/agent-lifecycle.md)). Read both before starting.

The track's birds-eye view is good. What's broken: **robustness** (a row you click can 404),
**control legibility** (Archive on a still-running agent, no Stop), and **visibility** (no honest
token cost, runaway names, no cleanup of finished work). Every item below is a symptom the tester hit,
traced to a line, with the fix and the files it lands in.

---

## Design north stars

1. **Observable, not controllable — closing a view never controls.** Opening a subagent in a tab is a
   read gesture; it must never stop, cancel, or archive the run. The only way to end a subagent is an
   explicit Stop/Archive. Closing a tab is layout-only, always.
2. **The action matches the state.** Running → **Stop**. Terminal → **Archive**. Never Archive on a
   running agent; never do two things at once ("close + cancel + archive").
3. **Honest cost, always visible.** Token/cost numbers come from the provider, never an estimate,
   shown per-row so a fan-out's cost is legible in real time.
4. **Names are labels, not summaries.** A row is a tab label: a short, stable name set at birth that
   never mutates into the agent's latest output.
5. **Finished work tidies itself, but stays reachable.** Completed rows leave the active list
   automatically; their cost + transcript remain until the user clears them.

---

## The six items

Each: **Symptom → Cause (file:line) → Fix → Lands in.**

### 1 — Clicking a subagent 404s even though it ran fine · _P0, headline bug_

- **Symptom:** started an agent with the right tool; row appeared; clicking it opened a tab with a
  full-bleed **"Agent not found"**. The run was actually fine — parent got its result — but nothing
  was watchable.
- **Cause:** the pane hydrates a tab by RPC-fetching when the agent isn't already a full store record
  — [`agent-panel.tsx:612`](../../packages/app/src/panels/agent-panel.tsx#L612) `client.fetchAgent`,
  and `null` → the `not_found` screen
  ([agent-panel.tsx:643](../../packages/app/src/panels/agent-panel.tsx#L643)). **Observed subagents
  are ephemeral projections** never written to `$OTTO_HOME/agents/**`, so `fetchAgent` returns `null`
  → 404. The track row (built from the live stream in
  [`select.ts`](../../packages/app/src/subagents/select.ts)) and the fetch-backed pane disagree about
  whether the agent exists.
- **Fix:**
  - For `attend === "observed"`, render from the in-store projection + streamed timeline; **skip the
    `fetchAgent` round-trip entirely**. Only attended agents (real persisted records) may fall back to
    `fetchAgent`.
  - When a track row still references the id but the record is mid-hydration/streaming, show a
    **loading/retry** state, never a dead-end error.
  - **Diagnose the native path separately.** If the tester's agent was a native `create_agent`
    subagent (a persisted record), a 404 is a _linking/timing_ bug — the row's `id` doesn't resolve
    (race between `create_agent` returning and the record landing in cwd-keyed storage, or a
    cwd/workspace storage-key mismatch). Reproduce native + observed independently; they may be two
    bugs behind one error screen.
- **Lands in:** `packages/app/src/panels/agent-panel.tsx` (lookup gating + loading state); possibly a
  daemon observed-resolver so `fetchAgent` returns the projection from
  `AgentManager.observedSubagents`; native repro may touch `create-agent/create.ts` /
  `agent-storage.ts` keying.

### 2 — No Stop; Archive offered while running · _P0_

- **Symptom:** hovering a row shows **Archive** even while active. "Is that close-and-cancel-and-
  archive? Archive is for when it's done. While active I want **Stop**, then archive."
- **Cause:** [`track.tsx` `SubagentRowActions`](../../packages/app/src/subagents/track.tsx#L187)
  renders a fixed `archive` (+ optional `detach`) regardless of `row.status`; no Stop on the row. A
  stop path exists (`agent.subagent.stop.request` for observed; lifecycle stop for native) but only in
  the pane ([`observed-subagent-callout.tsx`](../../packages/app/src/components/observed-subagent-callout.tsx)).
- **Fix:** row primary action = `f(row.status)`:
  - `initializing` / `running` → **Stop** (transitions to terminal; **does not** remove the row).
  - terminal (`idle` after completion / `error` / `closed`) → **Archive** (drops the row; cascade
    unchanged).
  - **Detach** stays native-only, its own affordance (already hidden for observed at
    [track.tsx:154](../../packages/app/src/subagents/track.tsx#L154)).
  - Keep the hover / always-visible-on-native cluster; every icon keeps a tooltip.
- **Lands in:** `packages/app/src/subagents/track.tsx`, `select.ts` (surface `status` already
  present), a `use-stop-subagent` hook mirroring `use-archive-subagent.ts`; new i18n keys
  `subagents.stopAction` / `subagents.stopTooltip` (English first).

### 3 — No honest token cost on the row · _P1; needs a daemon accumulator_

- **Symptom:** "I should see the full token count of all the messages for that agent chat, right of
  the name — honest cost from the provider — so we see what launching all these subagents costs."
- **Cause + the catch:** `AgentUsage` =
  `{ inputTokens, cachedInputTokens, outputTokens, totalCostUsd, contextWindowMaxTokens, contextWindowUsedTokens }`
  ([agent-types.ts:174](../../packages/protocol/src/agent-types.ts#L174)). But `agent.lastUsage` is
  **replaced wholesale each turn** ([agent-manager.ts:3464](../../packages/server/src/server/agent/agent-manager.ts#L3464)),
  so its `inputTokens`/`outputTokens` are **last-turn only, not cumulative**. `totalCostUsd`
  ([claude/agent.ts:1826](../../packages/server/src/server/agent/providers/claude/agent.ts#L1826)) _is_
  cumulative — but local / openai-compat models often report no cost. `contextWindowUsedTokens` is
  current context occupancy and **resets on compaction** — not honest cumulative spend. **So no
  cumulative-token field exists today.**
- **Fix:**
  - **Daemon:** accumulate a running per-agent token total (Σ input+output across turns) as usage
    events arrive, stored on the agent record and projected onto the snapshot. This is the honest
    "all messages" number, and the only currency that works for cost-less local models.
  - **Client:** thread the cumulative total into `SubagentRow`; render compact + dim + tabular
    immediately right of the name (e.g. `12.3k`). Show `totalCostUsd` too when the provider gives it.
  - **Header:** sum across rows in the collapsed track header
    ([`formatHeaderLabel`](../../packages/app/src/subagents/track-presentation.ts#L29)) — directly
    answers "what is this fan-out costing." Include completed rows so cost survives the tidy (Item 6).
  - Confirm the observed `usage` on `task_progress`/`task_notification` is cumulative-per-subagent; if
    it is, observed rows can use it directly instead of the accumulator.
- **Lands in:** `agent-manager.ts` (accumulator) + `agent-projections.ts` (project the total);
  `protocol/agent-types.ts` (additive optional cumulative field if the snapshot lacks one);
  `subagents/select.ts`, `track.tsx`, `track-presentation.ts`.

### 4 — Runaway names · _P1_

- **Symptom:** "subagents get ridiculously long names — almost their whole response. They should get
  short names and keep them; it's like listing tabs."
- **Cause (observed):** the title is overwritten every progress tick with the AI progress summary —
  [`claude/agent.ts:3915`](../../packages/server/src/server/agent/providers/claude/agent.ts#L3915)
  `description: message.summary ?? message.description` on `task_progress`, mapped straight to `title`
  at [`agent-projections.ts:315`](../../packages/server/src/server/agent/agent-projections.ts#L315).
  With `agentProgressSummaries: true`, `summary` is a long, ever-changing blurb.
- **Fix:**
  - Derive the row name **once at `task_started`** from `subAgentType` (+ optional truncated one-line
    slice of the initial `description`), then **freeze it** — `task_progress.summary` must not mutate
    the title.
  - Keep the rich `summary` as the pane's live activity/subtitle, not the label.
  - Enforce a hard max length + single-line truncation in the projection so no provider can produce a
    wall-of-text label.
  - Confirm native subagents follow the same rule (row name = short title, not an output summary).
- **Lands in:** `packages/server/src/server/agent/providers/claude/agent.ts` (don't feed `summary`
  into the observed title), `agent-projections.ts` (freeze + truncate title).

### 5 — Closing an opened subagent must not cancel it · _P0, pairs with Item 2_

- **Symptom:** "open one and you have to let it run its course, otherwise you're cancelling/archiving
  it. It should just close but keep going."
- **Cause:** to confirm by repro. `agent-lifecycle.md` already says subagent tab-close is layout-only
  ([`handleCloseAgentTab`](../../packages/app/src/screens/workspace/workspace-screen.tsx)) — so this
  is either a regression (observed/native tab-close falling into the root-agent archive-on-close
  branch) or the Item-2 confusion (user clicking **Archive** on a running row). Both plausible.
- **Fix + guarantee with tests:**
  - Closing any subagent tab (native or observed) is **layout-only** — never stops/cancels/archives;
    re-openable from the track.
  - The **only** stop is the explicit Stop action (Item 2). Verify the observed pane Stop and the row
    Stop are the _only_ callers of `stopTask`, and tab lifecycle can't reach them.
- **Lands in:** regression tests beside
  [`close-tab-policy.test.ts`](../../packages/app/src/subagents/close-tab-policy.test.ts) asserting
  observed + native tab-close leave lifecycle untouched; fix in `workspace-screen.tsx` /
  `close-tab-policy.ts` if a branch leaks.

### 6 — Auto-cleanup of finished subagents · _P2; semantics resolved_

- **Symptom:** "when a subagent finishes it should auto-clean from the list, not sit there for me to
  prune."
- **Cause:** no automatic pruning; `agent-lifecycle.md` "Subagent accumulation" documents the gap.
- **Resolved semantics (fork owner, 2026-07-12): group-not-destroy + manual clear.**
  - Auto-tidy completed rows into a collapsed **"Completed (N)"** group at the bottom of the track
    (collapsed by default), retaining each row's frozen name + final token total. The active list then
    shows only in-flight subagents.
  - Pair with a manual **"Clear all completed"** bulk gesture that archives every _terminal_ row in
    one action (never touches a running one). Removal stays user-initiated; nothing is destroyed until
    the user clears (or the parent is archived, which already cascades).
  - The parent-level token total (Item 3) sums **all** rows incl. completed, so cost history survives
    the tidy.
  - **No automatic hard-archive** on completion (would kill the cost/transcript). Revisit a
    time/threshold auto-archive only if the group still feels cluttered in practice.
  - This is a **client-side presentation** change first (group by terminal status), avoiding lifecycle
    changes.
- **Lands in:** `subagents/track.tsx` + `track-presentation.ts` (group by terminal status, header
  total), a bulk-archive action reusing `use-archive-subagent.ts`. Small open sub-question: does
  "Clear all completed" confirm first?

---

## Cross-cutting invariant: row and agent never disagree

The 404 is one instance of a general rule — **a track row and the agent it points to must never
disagree about existence**. Audit as part of Item 1:

- Observed subagent id determinism (`${parentAgentId}::sub::${key}`) vs. the id the row/tab navigate
  with — one format drift = a permanent 404.
- Reconnect/restart: observed rows are ephemeral and vanish until the next live event. Decide whether
  a mid-run reconnect rehydrates from the parent's replayable timeline (**leaning yes**) so an open
  tab survives instead of 404-ing.
- `not_found` must distinguish "genuinely gone" from "not yet hydrated / streaming" and offer retry
  whenever a row still references the id.

---

## Protocol / compat

Follow [CLAUDE.md](../../CLAUDE.md) + [rpc-namespacing.md](../../docs/rpc-namespacing.md).

- **Reuse** `agent.subagent.stop.request/.response` and native lifecycle stop — **no new Stop RPC.**
- Status-aware actions, name-freezing, and completed-grouping are **client + daemon-projection**
  changes over data already on the wire (`status`, `attend`, `title`, `lastUsage`). No schema break.
- The **cumulative-token total** (Item 3) is the one likely new field: add it **optional/additive** to
  the agent snapshot; old clients ignore it.
- Any new daemon capability (observed `fetchAgent` resolver, reconnect rehydration) gates behind
  `server_info.features.*` with a dated `COMPAT(...)` marker; **no fallback path** on old daemons.

---

## Build sequence

Ordered by pain/robustness; each phase is independently shippable and verifiable.

1. **P0 — Kill the 404 (Item 1 + cross-cutting invariant).** Render observed subagents from the store
   projection without a persistent fetch; replace the dead-end error with loading/retry; reproduce +
   fix the native linking case. _Verify: open an observed and a native subagent mid-run, no 404._
2. **P0 — Control legibility (Items 2 + 5).** Status-aware row action (Stop when running / Archive
   when terminal); lock tab-close as layout-only with regression tests. _Verify: Stop a running
   subagent from the row; close its tab and confirm it keeps running._
3. **P1 — Freeze names (Item 4).** Stop `task_progress.summary` mutating the title; derive a short
   stable label at `task_started`; enforce max length. _Verify: fan out an ultracode run; names stay
   short + stable._
4. **P1 — Honest token cost (Item 3).** Daemon cumulative accumulator; per-row + header totals;
   confirm cumulative-vs-delta first. _Verify: watch a subagent's token count grow honestly; header
   sums the fan-out._
5. **P2 — Auto-tidy completed (Item 6).** "Completed (N)" group retaining name + total; "Clear all
   completed" bulk archive. _Verify: completed rows leave the active list, cost survives, one click
   clears them._
6. **End-to-end verify** with (a) a Claude `Task`/ultracode fan-out and (b) a native `create_agent`
   subagent: open each mid-run without 404, watch, Stop, close-tab-without-cancel, honest growing
   cost, short stable name, auto-tidy on completion.

---

## Open questions (blocking = ⛔)

1. **Was the tester's 404 observed or native?** Determines whether Item 1 is one fix or two. Reproduce
   both. _(Not blocking the observed fix; do it first, then repro native.)_
2. ⛔ **Is observed `usage` on `task_progress`/`task_notification` cumulative-per-subagent?** If yes,
   observed rows skip the accumulator; if no, they use it too. Confirm before wiring Item 3.
3. **"Clear all completed" UX:** confirm-first or immediate? (Terminal rows only, regardless.)
4. **Reconnect rehydration for open observed tabs:** rehydrate from the parent's replayable timeline,
   or accept the ephemeral drop? Leaning rehydrate; ties into observed-subagents open question #1.
5. **Naming source:** is `subAgentType` alone (e.g. "code-explorer") enough, or `subAgentType` + short
   task slice? Affects Item 4 derivation.

---

## Non-goals

- Making observed subagents attended/promptable — still impossible, still not this work.
- A new track/tab/pane subsystem — this reuses the existing one.
- Changing native `create_agent` / detach / cascade semantics beyond surfacing Stop and the
  completed-grouping.

## Fold-in on ship

Fold the durable rules (tab-close is always layout-only; row action = f(status); names are frozen
labels; per-row provider token cost + daemon accumulator; completed-grouping) into
[../../docs/agent-lifecycle.md](../../docs/agent-lifecycle.md), update the observed-subagents "Known
v1 limits", then delete this folder per the projects convention.
