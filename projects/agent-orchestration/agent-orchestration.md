# Agent Orchestration — Teams as the Way Work Gets Done

**Status:** charter / not started. This is the point-in-time plan; durable facts fold into
`docs/` once shipped.

## Thesis

Otto has a rich **casting layer** — personalities, teams, roles, spinner/voice, availability —
and a thin **control layer**: imperative `create_agent`/`send_agent_prompt`/wait plus prose
skills the driving model hand-executes. We built _who_ does the work; we barely built _how a
team actually coordinates_. This project builds the control layer, and makes **Teams the way
work is invoked** — not an optional skill you reach for, but the default surface. If teams are
optional, users just pick a model and orchestration never happens.

The goal, stated by the product owner: a team member, handed a real task, **recognizes** when
the work is team-shaped, **plans** it, **draws up typed tasks for the right teammates**, runs
them, and returns a synthesized result — naturally, because it's the effective path, not because
it was asked. Small, simple tasks are done solo; complexity earns orchestration. (This is the
same complexity gate Claude's own Task tool applies to its subagents.)

## Prior art we're reviving (and improving)

Upstream Paseo shipped `/epic` — a 336-line orchestrator + a `roles.md` reference — and removed
it (`59b32ab3b`) around the fork point. Otto kept the light survivors (`otto-advisor`,
`otto-committee`, `otto-loop`, `otto-handoff`) and dropped the heavy conductor. `/epic` is the
thing we're rebuilding, with its weak part fixed. What we take:

- **Separate the _plan vocabulary_ from the _role cast_.** The plan used **phase types**
  (`refactor · implement · verify · gate · deliver`); roles were the _dispatcher's_ map of
  type→which-agent. The plan never named roles. This decoupling is the core idea.
- **A single-writer, resumable plan as source of truth** — survived compaction, resumable by a
  fresh conductor reading frontmatter `status` + first non-done phase.
- **Structured verifier output** — the `verify · spec` auditor returned "YES/NO per acceptance
  criterion, with evidence (file/line/test)."
- **Requirements-immutable + audit-every-bullet loop** — "not done until every requirement is
  met," loop back and re-dispatch on failure.

What we fix: `/epic` was **prose a model hand-executed**. We make the substrate a **daemon-owned
Run object with deterministic execution** (fan-out/gather/gate/loop in code, typed results),
so orchestrating is _cheaper_ than hand-tracking N agent IDs across async notifications — which
is the only way agents adopt it naturally.

## The roles (complete, proper set)

Otto's `orchestration-preferences.json` already names five work categories — `impl, ui, research,
planning, audit` — but only `impl→coder` and `audit→judger` became roles. The missing three
(`research`, `planning`, `ui`) are exactly the gap, confirmed by `/epic`'s `researcher`,
`planner`, `ui-impl`. New roles are additive (roles ride the wire as plain strings — back-compat).

**Conductor (1)** — owns the Run, decides solo-vs-fan-out, dispatches, gathers, gates:

- **orchestrator** — the _sole_ conductor. Today five roles carry the coordinator directive; that
  collapses to this one.

**Thinking workers (read-only, structured findings):**

- **researcher** _(NEW)_ — surveys code/domain, reports files/types/patterns/gotchas. No
  solutions, no edits. The job `advisor` was wrongly doing.
- **planner** _(NEW)_ — drafts the typed phase plan; iterated + adversarially reviewed. Planning
  is delegated to a specialist, not winged by the conductor.
- **judger** — evaluates work _or_ a plan against criteria; returns a **structured verdict**.
  Absorbs Paseo's plan-reviewer + `spec/qa/review` auditor variants.
- **advisor** — bounded second opinion; read-only, returns a recommendation, **does not fan out**.
  Reclassified worker (was mistakenly coordinator-tier + told to orchestrate).

**Making workers (produce code/content):**

- **coder** — fills `refactor` and `implement` phases (the phase type carries the
  behavior-preserving-vs-feature distinction; no separate `refactorer` _role_ needed).
- **designer** _(NEW)_ — the `ui` category + Paseo `ui-impl`: styling/layout + human-skill text
  (copy, naming). The "Opus for artistic work" lane the preferences already describe.
- **writer** — fast small-text mini-tasks (commits, PR text, names). Unchanged.

**Surfaces (unchanged):** **chatter** (interactive front / composer default), **artificer**
(artifacts), **scheduler** (schedules).

**Deterministic plan vocabulary** (fixed; used by the Run object, NOT roles):
`research → plan → refactor | implement | design → verify → gate → deliver`. Phase type → role:
research→researcher, plan→planner (judger reviews), refactor/implement→coder, design→designer,
verify→judger, gate→human, deliver→coder/writer.

## Teams as the invocation model

- **The active Team is the default surface.** A task is sent _to the team_; the composer's
  primary control becomes team/personality, with raw-model demoted to an escape hatch. (Depends on
  host-scoped `activeTeamId`, already shipped.)
- **Role-completeness becomes load-bearing.** A team that can conduct needs at minimum an
  orchestrator + coder + judger, ideally researcher/planner/designer. Starter team and the
  first-time-wizard role-fill must guarantee it; the editor should surface gaps.
- **Missing role → hard-fail (LOCKED).** When a task needs a phase whose role no team member
  fills, the conductor **refuses loudly and names the gap** ("this team has no researcher") — no
  silent fallback to a raw provider, matching the repo's no-fallback rule. Fix the team, don't
  paper over it. (`chatter` may hand a task to the team's `orchestrator` member; a chatter-only
  team surfaces the same completeness gap.)
- **The team's orchestrator member is the conductor.** It receives the task and applies the
  complexity gate: simple/not-splittable → do it solo (no ceremony); complex/parallelizable →
  plan + dispatch. Taught **only** by the conductor's **standing directive** (method, not just
  permission), so orchestration is emergent — **no separately-invoked `/epic`-style skill**
  (LOCKED). The method the directive teaches is the `/epic` playbook, distilled into the prompt.
- **How a user _deliberately_ sparks one — and how we stop "run X" from summoning a provider's
  own Workflow tool instead — is designed in [invocation.md](invocation.md)** (explicit composer
  surface + `/orchestrate`, Ask-first gate on Claude's `Workflow`, confirm-before-spawn caps,
  "Orchestration" as the one user-facing noun).

## The control substrate: a daemon orchestration runtime (LOCKED: full runtime)

**Decision: build the general runtime, not just a purpose-built Run object.** The daemon owns a
real orchestration engine — Otto's provider-agnostic answer to the harness `Workflow` tool:
deterministic **fan-out / gather-barrier / gate / loop** control flow, **schema-constrained worker
outputs**, and hard **concurrency + agent-count + token/spawn budget** caps (the guardrails
removed with the orchestrator gate now live here, structurally). The **Run** is the observable,
resumable projection of one execution.

The Run carries: typed phases, phase→teammate assignments, per-phase status
(`pending/running/done/blocked`), **structured judge verdicts**, gate points, an immutable
requirements block, and a Notes log. Properties:

- **Deterministic execution** — the runtime drives control flow in code, not prose; the conductor
  _declares_ the shape (phases, assignments, the loop target) and the daemon runs it. This is what
  makes orchestrating **cheaper** than hand-tracking N agent IDs — the precondition for emergent
  adoption.
- **Attended by default (LOCKED)** — a Run **pauses at `gate` phases** (plan approval, before
  deliver) for the user to approve/override; an explicit **autopilot** mode runs straight through.
  Ties into the safe-unattended posture ([docs/safe-unattended.md](../../docs/safe-unattended.md)).
- **One grouped run in the UI** — the user watches the team work, approves at gates, and
  overrides. This is where "you feel in control" is delivered. Builds on the observed-subagents
  track.
- **Resumable** — survives compaction and a conductor restart (read status + first non-done
  phase).
- **Structured outputs enforced at the tool boundary** — a spawned worker (esp. judger) returns
  schema-constrained JSON (`{verdict, score, criteria:[{name,met,evidence}], summary}`), so gates
  branch mechanically instead of parsing prose. Workers are **full, observable Otto agents** (a
  fan-out shows in the track), not lightweight ephemerals.

## Signature pattern: loop-until-N-good

Fan out over `research`/`implement` phases → structured-judge each → keep passers → if
`passers < N` (default: conductor targets ≥4 candidates) dispatch replacements → repeat until the
bar is met or a cap trips → synthesize. First-class control logic on the Run object, not prose.

## Build sequence

0. **Roles + reclassification.** ✅ **SHIPPED.** Added `researcher`, `planner`, `designer` to
   `PERSONALITY_ROLES` (regrouped: surfaces · thinking workers · making workers · conductor) and
   `PERSONALITY_ROLE_INFO`, all focused-tier; moved `advisor` to focused-tier (was wrongly
   coordinator + told to orchestrate); `orchestrator` is now the sole dedicated conductor role.
   Judger verdict schema landed as `packages/protocol/src/judge-verdict.ts`
   (`JudgeVerdictSchema` = `{verdict, score?, criteria?, summary?}`, outcome as forward-compat
   plain string via `normalizeJudgeOutcome`, unparseable → `fail`). Starter team now role-complete
   (Sage = advisor+researcher+planner thinker, Pixel = artificer+designer); wizard blueprints
   thread designer onto visual makers and give the Planning team a real researcher + planner.
   Additive/back-compat; typecheck + lint + protocol/wizard tests green. **Note:** `ROLE_LABELS` is
   triplicated across `agent-personalities-section.tsx`, `agent-teams-section.tsx`,
   `team-step.tsx` — consolidate to one exported map (flagged).
1. **The orchestration runtime + Run projection.** ✅ **SHIPPED (typecheck+lint+unit-test green;
   not yet runtime-verified against a live daemon).** The engine
   (`packages/server/src/server/orchestration/run-engine.ts`) drives fan-out / gather-barrier /
   gate / loop in code over injected seams (`RunEnginePort`); `buildRunFromPlan` validates the DAG.
   `RunStore` (file-backed, `$OTTO_HOME/runs/*.json`, atomic + per-id serialized) + `RunService`
   (owns runs, gate resolution w/ pre-registration buffering, change broadcast, orphan-recovery on
   init) project the typed `Run` (protocol `orchestration.ts`). Phases run in declared order;
   parallelism is fan-out-within-a-phase + per-candidate judging. Attended-gate pause built in;
   autopilot runs straight through. 28 orchestration unit tests.
2. **Runtime hardening.** ✅ **SHIPPED (partial).** Caps: `maxConcurrency` (bounded
   `mapWithConcurrency`), `maxAgents`, `maxLoopAttempts` (`DEFAULT_RUN_CAPS`). `wait_for_agents`
   MCP gather tool (the multi-agent barrier the daemon lacked). Structured judger output enforced
   by prompt-and-parse (`parseVerdict` extracts the first balanced JSON, `JudgeVerdictSchema`
   validates, unparseable → fail) — provider-level JSON-mode is only wired for OpenCode, so
   prompt-and-parse is the honest cross-provider path. Autopilot flag on the plan. **Deferred:**
   token/spawn _budget_ caps (only agent-count today); safe-unattended autopilot eligibility gate.
3. **Teams-as-invocation surface.** ✅ **conductor directive SHIPPED**
   (`ORCHESTRATOR_METHOD_DIRECTIVE` in `agent-personalities.ts` — complexity gate + distilled
   `/epic` method + `start_run`, injected only for the `orchestrator` role via
   `composeRoleFocusDirective`; non-orchestrator coordinators get a lighter delegate nudge).
   `start_run` resolves each phase's role to the active team's member (`resolveTeamRoleMember`) and
   hard-fails naming the gap. **Deferred:** composer defaulting to team / demoting raw-model (the
   bigger UX change).
4. **UI run rendering.** ✅ **SHIPPED (typecheck+lint green; not runtime-verified).** `/runs`
   route + `RunsScreen` (per-host sections, run cards with per-phase `StatusBadge` + verdict
   tallies, gate Approve/Reject + Cancel). Data via `useRuns` replica query (seeded by
   `runs.get_snapshot`, kept fresh by the `runs.updated.notification` push writer in
   `push-router.ts`). Client RPCs: `getRunsSnapshot` / `respondToRunGate` / `cancelRun`. Capability
   `useAgentOrchestrationFeature`. **Deferred:** richer detail (candidate drill-in, live elapsed),
   a nav entry point (route exists + is chrome-enabled; no menu link yet).

**Proof task:** _"start a research project with 6 sub-agents from different angles, a judger per
result with a quality gate, return the passers, synthesize a final report."_ Now expressible as a
declared Run: one `research` phase with `fanOut: 6` + `judge` + `keepBest`, then a `deliver` phase —
deterministic fan-out, typed verdicts, bounded, watchable. The engine's loop-until-N test covers
exactly this shape.

## What's shipped vs. remaining (as of this build)

**Shipped, green (typecheck + lint + 28 orchestration unit tests + protocol/push-router tests):**
protocol data model + judge verdict + `runs.*` RPCs + `agentOrchestration` capability; daemon
engine + store + service + role resolver; `start_run` / `get_run_status` / `wait_for_agents` MCP
tools; session RPC handlers + bootstrap construction + websocket capability + change broadcast;
conductor standing directive; client RPC methods; app replica hook + push writer + `/runs` screen.

**Not yet done / needs a human:**

- **Runtime verification.** The daemon spawn/await path (`createAgentCommand` + `waitForAgentEvent`
  wiring in `start_run`) is typechecked but NOT executed end-to-end — no integration test spawns
  real child agents through a Run. First real proof needs a live daemon run or an in-process
  ad-hoc-daemon integration test (see `docs/ad-hoc-daemon-testing.md`).
- Permission-blocked children: `awaitAgent` returns on a child's permission prompt; an unattended
  child that parks on a permission degrades to a failing candidate rather than blocking the run —
  acceptable v1, but unattended child mode / auto-approval posture is unaddressed.
- Token/spawn budget caps; autopilot eligibility tie-in to safe-unattended.
- Composer teams-as-default surface; a nav entry to `/runs`; richer run-detail UI.
- **The invocation UX** — explicit "Start orchestration" surfaces, the `Workflow` ask-gate, and
  the cost-confirm layer. Designed in [invocation.md](invocation.md); not started.
- The `ROLE_LABELS` triplication cleanup (Phase 0 note) — a background task was spawned.

## Locked decisions

- **Full orchestration runtime**, not a purpose-built Run object — Otto's provider-agnostic answer
  to the harness `Workflow` tool. The Run is its observable projection.
- **Attended by default** — Runs pause at `gate` phases for user approval; autopilot is explicit.
- **Missing role → hard-fail** with a named gap. No silent fallback to a raw provider.
- **Standing-directive only** for the conductor method — emergent orchestration, no `/epic` skill
  front door.
- **`designer` = styling/layout AND human-skill text** (copy/naming) — the preferences' `ui` lane.
- **Workers are full, observable Otto agents** (fan-outs show in the track), not ephemerals.
- **`chatter` may hand off to the team's `orchestrator` member**; a chatter-only team hits the
  same completeness gap.

## Still open

- Runtime **surface**: does the conductor declare a run via a new MCP tool (`start_run(plan)`), or
  does the runtime execute an internal plan the conductor writes? (Leaning a typed `start_run` tool
  so the declaration is schema-validated.)
- **Autopilot eligibility** — reuse the safe-unattended per-model Auto gating, or a separate
  team/run flag?
- Whether **coder** covers `design` phases when a team has no `designer` (vs hard-fail) — likely
  hard-fail for consistency, but styling-by-a-coder is a softer failure than research-by-nobody.
