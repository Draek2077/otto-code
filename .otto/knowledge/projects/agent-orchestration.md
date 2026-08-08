---
id: "agent-orchestration"
kind: "project"
title: "Agent Orchestration"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:19.830Z"
updated_at: "2026-08-08T06:19:41.455Z"
---

# Agent Orchestration

<!-- compiled_truth -->

# Agent Orchestration - Teams as the Way Work Gets Done

**Status:** charter / not started. This is the point-in-time plan; durable facts fold into
`docs/` once shipped.

## Thesis

Otto has a rich **casting layer** - personalities, teams, roles, spinner/voice, availability -
and a thin **control layer**: imperative `create_agent`/`send_agent_prompt`/wait plus prose
skills the driving model hand-executes. We built _who_ does the work; we barely built _how a
team actually coordinates_. This project builds the control layer, and makes **Teams the way
work is invoked** - not an optional skill you reach for, but the default surface. If teams are
optional, users just pick a model and orchestration never happens.

The goal, stated by the product owner: a team member, handed a real task, **recognizes** when
the work is team-shaped, **plans** it, **draws up typed tasks for the right teammates**, runs
them, and returns a synthesized result - naturally, because it's the effective path, not because
it was asked. Small, simple tasks are done solo; complexity earns orchestration. (This is the
same complexity gate Claude's own Task tool applies to its subagents.)

## Prior art we're reviving (and improving)

Upstream Paseo shipped `/epic` - a 336-line orchestrator + a `roles.md` reference - and removed
it (`59b32ab3b`) around the fork point. Otto kept the light survivors (`otto-advisor`,
`otto-committee`, `otto-loop`, `otto-handoff`) and dropped the heavy conductor. `/epic` is the
thing we're rebuilding, with its weak part fixed. What we take:

- **Separate the _plan vocabulary_ from the _role cast_.** The plan used **phase types**
  (`refactor · implement · verify · gate · deliver`); roles were the _dispatcher's_ map of
  type→which-agent. The plan never named roles. This decoupling is the core idea.
- **A single-writer, resumable plan as source of truth** - survived compaction, resumable by a
  fresh conductor reading frontmatter `status` + first non-done phase.
- **Structured verifier output** - the `verify · spec` auditor returned "YES/NO per acceptance
  criterion, with evidence (file/line/test)."
- **Requirements-immutable + audit-every-bullet loop** - "not done until every requirement is
  met," loop back and re-dispatch on failure.

What we fix: `/epic` was **prose a model hand-executed**. We make the substrate a **daemon-owned
Run object with deterministic execution** (fan-out/gather/gate/loop in code, typed results),
so orchestrating is _cheaper_ than hand-tracking N agent IDs across async notifications - which
is the only way agents adopt it naturally.

## The roles (complete, proper set)

Otto's `orchestration-preferences.json` already names five work categories - `impl, ui, research,
planning, audit` - but only `impl→coder` and `audit→judger` became roles. The missing three
(`research`, `planning`, `ui`) are exactly the gap, confirmed by `/epic`'s `researcher`,
`planner`, `ui-impl`. New roles are additive (roles ride the wire as plain strings - back-compat).

**Conductor (1)** - owns the Run, decides solo-vs-fan-out, dispatches, gathers, gates:

- **orchestrator** - the _sole_ conductor. Today five roles carry the coordinator directive; that
  collapses to this one.

**Thinking workers (read-only, structured findings):**

- **researcher** _(NEW)_ - surveys code/domain, reports files/types/patterns/gotchas. No
  solutions, no edits. The job `advisor` was wrongly doing.
- **planner** _(NEW)_ - drafts the typed phase plan; iterated + adversarially reviewed. Planning
  is delegated to a specialist, not winged by the conductor.
- **judger** - evaluates work _or_ a plan against criteria; returns a **structured verdict**.
  Absorbs Paseo's plan-reviewer + `spec/qa/review` auditor variants.
- **advisor** - bounded second opinion; read-only, returns a recommendation, **does not fan out**.
  Reclassified worker (was mistakenly coordinator-tier + told to orchestrate).

**Making workers (produce code/content):**

- **coder** - fills `refactor` and `implement` phases (the phase type carries the
  behavior-preserving-vs-feature distinction; no separate `refactorer` _role_ needed).
- **designer** _(NEW)_ - the `ui` category + Paseo `ui-impl`: styling/layout + human-skill text
  (copy, naming). The "Opus for artistic work" lane the preferences already describe.
- **writer** - fast small-text mini-tasks (commits, PR text, names). Unchanged.

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
  fills, the conductor **refuses loudly and names the gap** ("this team has no researcher") - no
  silent fallback to a raw provider, matching the repo's no-fallback rule. Fix the team, don't
  paper over it. (`chatter` may hand a task to the team's `orchestrator` member; a chatter-only
  team surfaces the same completeness gap.)
- **The team's orchestrator member is the conductor.** It receives the task and applies the
  complexity gate: simple/not-splittable → do it solo (no ceremony); complex/parallelizable →
  plan + dispatch. Taught **only** by the conductor's **standing directive** (method, not just
  permission), so orchestration is emergent - **no separately-invoked `/epic`-style skill**
  (LOCKED). The method the directive teaches is the `/epic` playbook, distilled into the prompt.
- **How a user _deliberately_ sparks one - and how we stop "run X" from summoning a provider's
  own Workflow tool instead - is designed in [invocation.md](invocation.md)** (explicit composer
  surface + `/orchestrate`, Ask-first gate on Claude's `Workflow`, confirm-before-spawn caps,
  "Orchestration" as the one user-facing noun).

## The control substrate: a daemon orchestration runtime (LOCKED: full runtime)

**Decision: build the general runtime, not just a purpose-built Run object.** The daemon owns a
real orchestration engine - Otto's provider-agnostic answer to the harness `Workflow` tool:
deterministic **fan-out / gather-barrier / gate / loop** control flow, **schema-constrained worker
outputs**, and hard **concurrency + agent-count + token/spawn budget** caps (the guardrails
removed with the orchestrator gate now live here, structurally). The **Run** is the observable,
resumable projection of one execution.

The Run carries: typed phases, phase→teammate assignments, per-phase status
(`pending/running/done/blocked`), **structured judge verdicts**, gate points, an immutable
requirements block, and a Notes log. Properties:

- **Deterministic execution** - the runtime drives control flow in code, not prose; the conductor
  _declares_ the shape (phases, assignments, the loop target) and the daemon runs it. This is what
  makes orchestrating **cheaper** than hand-tracking N agent IDs - the precondition for emergent
  adoption.
- **Attended by default (LOCKED)** - a Run **pauses at `gate` phases** (plan approval, before
  deliver) for the user to approve/override; an explicit **autopilot** mode runs straight through.
  Ties into the safe-unattended posture ([docs/safe-unattended.md](../../docs/safe-unattended.md)).
- **One grouped run in the UI** - the user watches the team work, approves at gates, and
  overrides. This is where "you feel in control" is delivered. Builds on the observed-subagents
  track.
- **Resumable** - survives compaction and a conductor restart (read status + first non-done
  phase).
- **Structured outputs enforced at the tool boundary** - a spawned worker (esp. judger) returns
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
   `team-step.tsx` - consolidate to one exported map (flagged).
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
   validates, unparseable → fail) - provider-level JSON-mode is only wired for OpenCode, so
   prompt-and-parse is the honest cross-provider path. Autopilot flag on the plan. **Deferred:**
   token/spawn _budget_ caps (only agent-count today); safe-unattended autopilot eligibility gate.
3. **Teams-as-invocation surface.** ✅ **conductor directive SHIPPED**
   (`ORCHESTRATOR_METHOD_DIRECTIVE` in `agent-personalities.ts` - complexity gate + distilled
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
declared Run: one `research` phase with `fanOut: 6` + `judge` + `keepBest`, then a `deliver` phase -
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
  wiring in `start_run`) is typechecked but NOT executed end-to-end - no integration test spawns
  real child agents through a Run. First real proof needs a live daemon run or an in-process
  ad-hoc-daemon integration test (see `docs/ad-hoc-daemon-testing.md`).
- Permission-blocked children: `awaitAgent` returns on a child's permission prompt; an unattended
  child that parks on a permission degrades to a failing candidate rather than blocking the run -
  acceptable v1, but unattended child mode / auto-approval posture is unaddressed.
- Token/spawn budget caps; autopilot eligibility tie-in to safe-unattended.
- Composer teams-as-default surface; a nav entry to `/runs`; richer run-detail UI.
- **The invocation UX** - explicit "Start orchestration" surfaces, the `Workflow` ask-gate, and
  the cost-confirm layer. Designed in [invocation.md](invocation.md); not started.
- The `ROLE_LABELS` triplication cleanup (Phase 0 note) - a background task was spawned.

## Locked decisions

- **Full orchestration runtime**, not a purpose-built Run object - Otto's provider-agnostic answer
  to the harness `Workflow` tool. The Run is its observable projection.
- **Attended by default** - Runs pause at `gate` phases for user approval; autopilot is explicit.
- **Missing role → hard-fail** with a named gap. No silent fallback to a raw provider.
- **Standing-directive only** for the conductor method - emergent orchestration, no `/epic` skill
  front door.
- **`designer` = styling/layout AND human-skill text** (copy/naming) - the preferences' `ui` lane.
- **Workers are full, observable Otto agents** (fan-outs show in the track), not ephemerals.
- **`chatter` may hand off to the team's `orchestrator` member**; a chatter-only team hits the
  same completeness gap.

## Still open

- Runtime **surface**: does the conductor declare a run via a new MCP tool (`start_run(plan)`), or
  does the runtime execute an internal plan the conductor writes? (Leaning a typed `start_run` tool
  so the declaration is schema-validated.)
- **Autopilot eligibility** - reuse the safe-unattended per-model Auto gating, or a separate
  team/run flag?
- Whether **coder** covers `design` phases when a team has no `designer` (vs hard-fail) - likely
  hard-fail for consistency, but styling-by-a-coder is a softer failure than research-by-nobody.

---

## Companion document: invocation.md

# Invocation UX - sparking an Orchestration deliberately

**Status:** design addendum to [agent-orchestration.md](agent-orchestration.md) / not started. Covers
the deferred "Teams-as-invocation surface" (build step 3) plus the guardrails against the
accidental-Workflow failure mode. Same fold-in rule as the charter: durable facts move to `docs/`
once shipped.

## The problem

The runtime shipped, but there is **no deliberate way for a user to start one**. The only path is
emergent: chat with an orchestrator-role agent and hope the standing directive
(`ORCHESTRATOR_METHOD_DIRECTIVE`, `packages/protocol/src/agent-personalities.ts`) kicks in. That
leaves "start a run" as plain prose to whatever model is in the tab - and the motivating incident
is exactly what that produces: the user asked a Claude agent for "a run", the agent didn't map the
phrase to Otto's tooling, and instead launched **Claude Code's own `Workflow` tool** - a costly
multi-agent fan-out the user never opted into. (A follow-on interrupt then killed that workflow;
workflows die with the parent turn - confirmed separately, not this doc's problem to fix.)

Two distinct failures to design out:

1. **No explicit on-ramp.** Orchestration-intent lives only in the model's interpretation of chat.
2. **Provider-native orchestration is ungated.** Claude's `Workflow`/`Task` fan-out can spend a
   large budget on a misread, with no confirm and no Otto-side cap.

The fix is not to make the model guess better - it's to **route intent at the Otto layer** and to
put a cost gate on every fan-out path regardless of who initiated it.

## Vocabulary (LOCKED - already in the glossary)

The user-facing noun is **Orchestration** - one execution of a declared multi-agent plan. The verb
phrase is **"Start orchestration"**. Code stays `Run`/`RunPhase` (`packages/protocol/src/orchestration.ts`);
only labels changed. This is already locked in [docs/glossary.md](../../docs/glossary.md)
("Orchestration" entry; "Run" is a forbidden UI synonym - it collides with the forbidden synonym
for Agent session). Everything below uses it: the sidebar entry is "Orchestrations", the composer
action is "Start orchestration", the slash command is `/orchestrate`. The charter's prose keeps
saying "Run" when it means the code object; UI copy never does.

The word also matters for the disambiguation problem itself: "orchestration" is Otto vocabulary
with no provider-tool collision, whereas "run a workflow" is precisely the phrase that summons
Claude's `Workflow` tool. Naming the surfaces "orchestration" trains the user out of the ambiguous
phrasing for free.

## Explicit invocation surfaces

Candidates considered: a dedicated composer action, a composer slash command, a team-switcher
"Run with this team…" entry, a workspace-header button, and a CTA on the Orchestrations screen.

### Primary: "Start orchestration" in the composer (creation sheet)

Invocation is a prompt-shaped act - the user's contribution is a goal written in words - so it
belongs where prompts are written: an entry in the **composer's attachment (+) menu**, next to
"Attach issue or PR". Picking it opens a lightweight creation sheet (same form-kit shape as the
schedule sheet, [docs/forms.md](../../docs/forms.md)):

- **Goal** (required - prefilled with whatever was already typed in the composer input).
- **Team** - defaults to the active team; role-completeness is checked inline and a gap renders as
  a named error ("this team has no researcher"), reusing the hard-fail resolution the runtime
  already has (`resolveTeamRoleMember`). No team active → the sheet says so and deep-links the
  switcher; it never silently falls back to raw providers (charter LOCKED rule).
- **Attended / Autopilot** - defaults attended (charter LOCKED); autopilot is the explicit toggle
  and stays subject to the safe-unattended posture.
- **Limits** - max agents (prefilled from `DEFAULT_RUN_CAPS`), token/spawn budget once that cap
  lands (charter deferred item). Collapsed under "Advanced"; least-setup means goal + defaults is
  a one-field submit.
- **Workspace** - implicit: the current workspace, like every composer send.

Submitting spawns the team's **orchestrator member** as a new agent session whose initial prompt
is the goal plus a short bootstrap ("plan this and declare it with `start_run`") - the same
conductor + `start_run` path as emergent orchestration, so there is exactly one execution
substrate. The new session opens as a tab; the Orchestration appears on the Orchestrations screen
once declared.

This does **not** violate the charter's "no `/epic`-style skill front door" lock. That lock bans a
_prose skill the model hand-executes_ as the substrate; this is an Otto-layer UI surface feeding
the same daemon runtime. Emergent conduction stays the north star - the explicit surface is the
deterministic on-ramp for the user who already knows the work is team-shaped.

### Power path: `/orchestrate` in the composer

Typing `/orchestrate <goal>` in the composer input fires the same creation flow with all defaults
(active team, attended, default caps) - no sheet unless something needs resolving (no active team,
role gap), in which case the sheet opens prefilled. One primary + one power path; both converge on
the identical spawn. (`/run` is rejected as the command name - same vocabulary collision.)

### Demoted (build later or never)

- **Orchestrations screen CTA** - the empty state should carry a "Start orchestration" button that
  opens the same sheet; cheap, do it with the sheet, but it's a discovery aid, not the primary.
- **Team switcher "Run with this team…"** - cute, but the switcher's job is switching; overloading
  it muddies "active team" (a standing default) with "invoke now" (an act). Skip.
- **Workspace-header button** - header space is contested and orchestration is not a per-glance
  action. Skip.

## The disambiguation problem

Today "run X" in plain chat goes to the provider model, which may satisfy it with **its own**
orchestration primitives. Three layers of guardrail, independent and stacking:

### (a) Permission-gate Claude's `Workflow` tool - default **Ask first**, not disallow

The plumbing exists: provider `runtimeSettings.disallowedTools` merges into the SDK's
`disallowedTools` (`packages/server/src/server/agent/providers/claude/agent.ts`, `buildOptions`),
the `canUseTool` permission callback (`handlePermissionRequest`) is already how Otto arbitrates
tools, and the `dontAsk` allowlist (`applyDontAskAllowlist`) already **deliberately excludes
`Workflow`** while allowing `Task` - so unattended runs are covered today. The gap is attended
mode, where `Workflow` auto-runs like any in-model tool.

**Recommendation: gate, don't amputate.** Hard-disallowing `Workflow` contradicts the fork's
mission - we level capabilities up, we don't take a provider's native strength away. Instead:

- **Default posture: Ask first.** `Workflow` (and only `Workflow` - plain `Task` subagents stay
  ungated; they're small and already observed) triggers a permission prompt before executing,
  implemented as a permission rule / `canUseTool` interception rather than `disallowedTools`.
  The prompt names the cost shape ("Claude wants to start its own multi-agent workflow (N tasks);
  this runs outside Otto's orchestration caps") and - until the interrupt-kills-workflow behavior
  changes - warns that interrupting the session kills it.
- **Where the setting lives: host-level Claude provider setting** ("Provider-native workflows:
  Allow / Ask first / Off", default Ask first), with a **per-personality override** riding
  personality config for the two natural exceptions: an orchestrator personality that should
  never compete with the Otto runtime (Off), and a dedicated "ultracode crusher" personality
  (Allow). Host-level matches where provider behavior is configured; per-personality matches
  where spawn behavior is specialized. Not per-team - teams scope personalities, not models.
- **Explicit opt-ins bypass the ask.** Selecting the `ultracode` effort option **is** consent -
  the user picked a fan-out-branded option by hand ([docs/glossary.md](../../docs/glossary.md),
  Effort) - so that session gets Allow. Likewise an in-prompt "use Claude's Workflow" satisfied
  after one ask should be rememberable per-session via the normal permission-response semantics.

### (b) Route orchestration-intent at the Otto layer

The primary defense is structural, not a prompt patch: with the composer surface and
`/orchestrate` shipped, a user who wants an Orchestration never has to phrase it into chat at all

- intent is captured by Otto and lands as a typed spawn, before any model interprets anything.
  Chat-phrased intent remains legitimate (emergent orchestration is the charter's thesis), but it
  should resolve correctly too: amend `ORCHESTRATOR_METHOD_DIRECTIVE` with one sentence - when the
  user asks for a run/orchestration, **`start_run` is the tool that means; never satisfy it with
  provider-native workflow tools**. Non-orchestrator personalities get nothing new: for them the
  Workflow ask-gate in (a) is the backstop, and the prompt it raises is itself the disambiguation
  moment ("did you want an Otto orchestration instead?" is reasonable prompt copy).

### (c) Cost guardrails on every path

Regardless of how a fan-out starts, spending N agents needs opt-in:

- **Otto Orchestrations:** the runtime inserts an **implicit plan-approval gate before the first
  spawn** whenever the run was _model-initiated_ (emergent, no explicit user invocation) - the
  user sees the typed plan, the phase→member assignments, and the total planned agent count, and
  approves before anything spawns. Explicitly-invoked runs (sheet / `/orchestrate`) already carry
  the user's opt-in at the declared scale, so they proceed to the plan's own declared gates -
  **unless** declared fan-out exceeds a confirm threshold (default **5** candidates in flight;
  rides `DEFAULT_RUN_CAPS`), which re-raises the gate even on explicit runs. Autopilot never
  skips the model-initiated pre-spawn gate - autopilot is "don't pause at plan-declared gates",
  not "spend without asking".
- **Provider-native workflows:** the Ask-first prompt in (a) is the confirm. Otto cannot pre-count
  a Workflow's agents (the provider owns the plan), which is precisely why the prompt fires
  _before_ execution rather than at some spawn threshold.
- Both are daemon-enforced, matching the charter's posture that guardrails live structurally in
  the runtime, not in prose.

## Coexisting with provider-native workflows

Sometimes the user _does_ want Claude's ultracode/Workflow - it's a genuinely strong primitive.
How they say so, in order of explicitness:

1. **Pick the `ultracode` effort option** in the composer's Effort control - the designed,
   per-session opt-in (bypasses the ask-gate per (a)).
2. **Say it and approve the ask** - "use Claude's Workflow for this" → the Ask-first prompt →
   approve (optionally for the session).
3. **Set the personality/host posture to Allow** for a personality whose whole job is that.

Once running, a Workflow surfaces through the **observed-subagents track** as it does today
(`task_type: "local_workflow"` → an observed row titled `Workflow: <name>`, settled via
`task_notification`; see [projects/observed-subagents/observed-subagents.md](../observed-subagents/observed-subagents.md)).
Known gap, noted not solved here: **workflow rows render like plain Task subagent rows** - no
grouped, plan-shaped rendering like Otto Orchestrations get on the Orchestrations screen. Closing
that (a grouped workflow row, or projecting an observed Workflow as a read-only Orchestration) is
observed-subagents-track work. The Ask-first prompt copy should also carry the liveness caveat
from the motivating incident until it's fixed: an interrupt to the parent session kills the
workflow.

## Open questions (with recommendations)

- **Does the explicit surface reuse the current chat agent as conductor, or spawn fresh?**
  Recommend **spawn fresh** (the team's orchestrator member, new session): keeps the chat tab's
  context clean, makes the conductor's identity deterministic (team-resolved, not
  whoever-was-in-the-tab), and gives the Orchestration a dedicated observable session. A current
  tab that already _is_ the team's orchestrator may be reused - same resolution, zero surprise.
- **Ask-first default vs Allow for `Workflow`:** recommend **Ask first**. The incident shows the
  cost of silent Allow; Off by default contradicts the mission. Revisit if the ask proves noisy -
  the per-session remember should keep it to one prompt per intentional use.
- **Confirm threshold default:** recommend **5** in-flight candidates (the conductor's own target
  is ≥4 per the charter, so 5 keeps the standard shape prompt-free on explicit runs while
  catching runaway plans). Configurable alongside `maxAgents` in the sheet's Advanced section.
- **Do other providers need the same gate?** The design is provider-agnostic by construction -
  (a) generalizes to "any provider-native multi-agent primitive gets an Ask-first posture" (the
  observed-subagents provider-adapters work will enumerate them per provider); (b) and (c) are
  provider-blind already. Claude is the proof, per the fork's rule - a capability isn't done when
  one provider has it.
- **Should `/orchestrate` accept inline flags** (`--team`, `--autopilot`, `--max-agents`)?
  Recommend **not in v1** - the sheet is the escape hatch for non-defaults; flags can ride later
  without breaking anything.

## Timeline

- time: "2026-08-08T06:17:19.830Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:19.830Z"
  kind: "evidence"
  summary: "Migrated from `projects/agent-orchestration/agent-orchestration.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: The **control layer** - Teams as the way work is invoked, typed tasks, recognize → plan → delegate → synthesize. Quarter-scale. Companion: [invocation.md](agent-orchestration/invocation.md)"
- time: "2026-08-08T06:19:41.455Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
