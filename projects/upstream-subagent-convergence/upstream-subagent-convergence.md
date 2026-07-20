# Upstream subagent convergence

**Status:** Charter, 2026-07-20. Nothing built. Blocked on the Phase 1 merge landing (upstream `v0.2.0`, currently untagged).

Otto and Paseo independently built the same feature. Upstream shipped provider
subagents in `v0.1.107` ([#2013](https://github.com/getpaseo/paseo/pull/2013));
Otto shipped [observed subagents](../observed-subagents/observed-subagents.md) on
2026-07-08. Both promote a provider's internally-spawned subagents (Claude `Task`,
Codex, OpenCode child sessions) to visible rows. The implementations disagree on
essentially every axis, and the collision sits in the files with the heaviest
churn on both sides.

This charter defines how the two stop being rivals **without Otto giving up the
capabilities upstream's model has no room for**.

---

## The problem, stated precisely

Not "whose design is better." Otto's model is better _for Otto_ — it carries
per-subagent usage accounting, arbitrary nesting, and stop control that upstream's
descriptor cannot express. The problem is **cost of divergence over time**:

Every upstream fix to provider-subagent ingestion lands in files Otto has also
rewritten. Their five subagent commits since our baseline concentrate in
`codex-app-server-agent.ts` (×4), `claude/agent.ts` (×2), and
`claude/sidechain-tracker.ts` (×2) — all correctness fixes for exactly the failure
modes Otto also has (phantom parents, stuck parent sessions, hidden Codex rows).
Carrying a rival ingestion path means hand-merging that stream forever, and
declining it means re-discovering the same bugs independently.

|            | Upstream provider subagents                                | Otto observed subagents                                       |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Model      | Side-channel descriptor; **not** an agent                  | Real `Agent` record, `attend: "observed"`                     |
| Store      | `ProviderSubagentStore`, keyed `parentAgentId\0subagentId` | `AgentManager.observedSubagents`, id `${parent}::sub::${key}` |
| Wire       | `agent.provider_subagents.*` (list/timeline/update)        | Existing agent RPCs + `agent.subagent.stop.*`                 |
| Status     | `running \| completed \| failed \| canceled`               | Full `AgentLifecycleStatus` + `requiresAttention`             |
| Nesting    | Flat                                                       | Arbitrary depth (`::sub::` chains)                            |
| Usage/cost | **No field at all**                                        | Per-subagent usage → Metrics ledger, with parent de-inflation |
| Stop       | None                                                       | `stopTask`-backed                                             |
| Client     | Second zustand store + separate panel; `select.ts` union   | Rows in the normal track via `parentAgentId`                  |

---

## The seam: split by layer, not by feature

**Take upstream's daemon-side ingestion verbatim. Keep Otto's presentation and
accounting. Project one into the other.**

The split follows where each side's churn actually lives. Upstream's recurring
value is provider ingestion — that's where their bug fixes land. Otto's value is
everything downstream of it. So:

```
provider (Claude/Codex/OpenCode)
  └─ upstream adapters + ProviderSubagentStore   ← THEIRS, verbatim, never edited
       └─ Otto projection layer                  ← OURS, new files
            ├─ id mapping (tuple ⇄ ::sub:: id)
            ├─ usage/cost side table
            ├─ nesting derivation
            └─ stop control
                 └─ Otto subagents track          ← OURS, unchanged
```

### Rules

1. **Upstream's ingestion files are read-only to us.** `ProviderSubagentStore`,
   the `agent.provider_subagents.*` handlers, and every provider adapter are taken
   unmodified and never edited. If one needs a change, it goes upstream as a PR —
   a local edit re-opens the conflict stream this whole charter exists to close.
2. **Identity is a deterministic bijection**, not a new namespace. Otto's
   synthetic id becomes a pure function of upstream's tuple:
   `${parentAgentId}::sub::${subagentId}` — invertible, so every existing Otto RPC
   (`archiveAgent`, `fetchAgent`, `fetchAgentTimeline`, the `agent_stream`
   forwarding path) keeps working with no signature change. This is the load-
   bearing decision: get it right and the rest of Otto is untouched.
3. **What upstream's descriptor can't hold lives in our files, keyed by their id.**
   Usage/cost, nesting, and stop state go in a side table. `TaskTranscriptWatcher`
   already reads usage from transcripts on disk — it keys off upstream's descriptor
   instead of minting its own identity, and the disk stays authoritative
   (see [subagent-accounting.md](../../docs/subagent-accounting.md)).
4. **The client carries a small, permanent, documented patch:** don't register
   upstream's `provider-subagent-panel`, don't take their `select.ts` discriminated
   union. Without this, every subagent renders twice in the same track. This is a
   real carried cost — but it is ~3 files of presentation, which churns
   cosmetically, not for correctness.

### What Otto deletes

Otto's own **ingestion** — the Claude sidechain path that mints observed rows
directly. Otto's projection, protocol surface, accounting, and UI all stay. This
is the point: one ingestion truth, not two.

---

## What this buys, and what it costs

**Buys:** upstream's Codex and OpenCode child-session coverage lands for free
(Otto's own adapter work for those is currently unstarted —
[provider-adapters.md](../observed-subagents/provider-adapters.md)); their
ongoing correctness fixes merge clean indefinitely; the worst files in the merge
(`agent-manager.ts`, `claude/agent.ts`, `sidechain-tracker.ts`) stop conflicting
on this feature.

**Costs, honestly:**

- A real refactor of observed-subagents internals, touching the accounting path.
  Sequence it _after_ the Phase 1 merge — doing both at once makes failures
  unattributable.
- Otto loses provider-neutral ingestion for providers upstream doesn't cover.
  Today upstream covers Claude, Codex, and OpenCode, which is Otto's set — but
  a provider Otto adds first (a natively-tooled openai-compat model spawning
  sub-tasks) needs its own ingestion, which then lives in Otto files. Keep the
  projection layer's input contract provider-neutral so that path exists.
- Upstream may later add usage to their descriptor in a shape incompatible with
  the side table. Acceptable — reconcile then, and prefer upstreaming Otto's
  shape before they design their own.

---

## Verification

The convergence is done when all of these hold:

- Upstream's ingestion files are byte-identical to `upstream/main`
  (`git diff upstream/main -- <paths>` is empty), and a subsequent upstream merge
  touching them produces no conflict.
- A Claude `Task` fan-out produces the same track rows, nesting, and Metrics
  ledger totals as before the refactor — the existing observed-subagent tests
  (`agent.sub-agent-sidechain.test.ts`, `agent-manager.observed-*.test.ts`,
  `wire-compat.test.ts`) pass unchanged, since the id scheme is preserved.
- A Codex or OpenCode subagent — never previously visible in Otto — appears as a
  track row with working timeline and stop.
- No subagent renders twice.

---

## Open questions

- **Timeline storage.** Upstream keeps its own `InMemoryAgentTimelineStore` keyed
  by their tuple. Does Otto project rows out of it, or keep recording into its own
  timeline under the mapped id? Projecting is less duplication; recording locally
  preserves Otto's history-replay behavior. Decide before implementation.
- **Status mapping.** Their 4-value enum → Otto's `AgentLifecycleStatus` +
  `requiresAttention` is lossy in one direction. In particular, upstream has no
  "needs attention" concept, and the usage-exhaustion signal Otto surfaces from
  `task_notification` `failed` may not survive their adapter. Verify against a
  real failing subagent before trusting the mapping.
- **Feature gates.** `features.observedSubagents` and `features.providerSubagents`
  can coexist on the wire. Does Otto advertise both, or keep advertising only its
  own? Affects what an old Otto client does against a converged daemon.
