# Invocation UX — sparking an Orchestration deliberately

**Status:** design addendum to [agent-orchestration.md](agent-orchestration.md) / not started. Covers
the deferred "Teams-as-invocation surface" (build step 3) plus the guardrails against the
accidental-Workflow failure mode. Same fold-in rule as the charter: durable facts move to `docs/`
once shipped.

## The problem

The runtime shipped, but there is **no deliberate way for a user to start one**. The only path is
emergent: chat with an orchestrator-role agent and hope the standing directive
(`ORCHESTRATOR_METHOD_DIRECTIVE`, `packages/protocol/src/agent-personalities.ts`) kicks in. That
leaves "start a run" as plain prose to whatever model is in the tab — and the motivating incident
is exactly what that produces: the user asked a Claude agent for "a run", the agent didn't map the
phrase to Otto's tooling, and instead launched **Claude Code's own `Workflow` tool** — a costly
multi-agent fan-out the user never opted into. (A follow-on interrupt then killed that workflow;
workflows die with the parent turn — confirmed separately, not this doc's problem to fix.)

Two distinct failures to design out:

1. **No explicit on-ramp.** Orchestration-intent lives only in the model's interpretation of chat.
2. **Provider-native orchestration is ungated.** Claude's `Workflow`/`Task` fan-out can spend a
   large budget on a misread, with no confirm and no Otto-side cap.

The fix is not to make the model guess better — it's to **route intent at the Otto layer** and to
put a cost gate on every fan-out path regardless of who initiated it.

## Vocabulary (LOCKED — already in the glossary)

The user-facing noun is **Orchestration** — one execution of a declared multi-agent plan. The verb
phrase is **"Start orchestration"**. Code stays `Run`/`RunPhase` (`packages/protocol/src/orchestration.ts`);
only labels changed. This is already locked in [docs/glossary.md](../../docs/glossary.md)
("Orchestration" entry; "Run" is a forbidden UI synonym — it collides with the forbidden synonym
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

Invocation is a prompt-shaped act — the user's contribution is a goal written in words — so it
belongs where prompts are written: an entry in the **composer's attachment (+) menu**, next to
"Attach issue or PR". Picking it opens a lightweight creation sheet (same form-kit shape as the
schedule sheet, [docs/forms.md](../../docs/forms.md)):

- **Goal** (required — prefilled with whatever was already typed in the composer input).
- **Team** — defaults to the active team; role-completeness is checked inline and a gap renders as
  a named error ("this team has no researcher"), reusing the hard-fail resolution the runtime
  already has (`resolveTeamRoleMember`). No team active → the sheet says so and deep-links the
  switcher; it never silently falls back to raw providers (charter LOCKED rule).
- **Attended / Autopilot** — defaults attended (charter LOCKED); autopilot is the explicit toggle
  and stays subject to the safe-unattended posture.
- **Limits** — max agents (prefilled from `DEFAULT_RUN_CAPS`), token/spawn budget once that cap
  lands (charter deferred item). Collapsed under "Advanced"; least-setup means goal + defaults is
  a one-field submit.
- **Workspace** — implicit: the current workspace, like every composer send.

Submitting spawns the team's **orchestrator member** as a new agent session whose initial prompt
is the goal plus a short bootstrap ("plan this and declare it with `start_run`") — the same
conductor + `start_run` path as emergent orchestration, so there is exactly one execution
substrate. The new session opens as a tab; the Orchestration appears on the Orchestrations screen
once declared.

This does **not** violate the charter's "no `/epic`-style skill front door" lock. That lock bans a
_prose skill the model hand-executes_ as the substrate; this is an Otto-layer UI surface feeding
the same daemon runtime. Emergent conduction stays the north star — the explicit surface is the
deterministic on-ramp for the user who already knows the work is team-shaped.

### Power path: `/orchestrate` in the composer

Typing `/orchestrate <goal>` in the composer input fires the same creation flow with all defaults
(active team, attended, default caps) — no sheet unless something needs resolving (no active team,
role gap), in which case the sheet opens prefilled. One primary + one power path; both converge on
the identical spawn. (`/run` is rejected as the command name — same vocabulary collision.)

### Demoted (build later or never)

- **Orchestrations screen CTA** — the empty state should carry a "Start orchestration" button that
  opens the same sheet; cheap, do it with the sheet, but it's a discovery aid, not the primary.
- **Team switcher "Run with this team…"** — cute, but the switcher's job is switching; overloading
  it muddies "active team" (a standing default) with "invoke now" (an act). Skip.
- **Workspace-header button** — header space is contested and orchestration is not a per-glance
  action. Skip.

## The disambiguation problem

Today "run X" in plain chat goes to the provider model, which may satisfy it with **its own**
orchestration primitives. Three layers of guardrail, independent and stacking:

### (a) Permission-gate Claude's `Workflow` tool — default **Ask first**, not disallow

The plumbing exists: provider `runtimeSettings.disallowedTools` merges into the SDK's
`disallowedTools` (`packages/server/src/server/agent/providers/claude/agent.ts`, `buildOptions`),
the `canUseTool` permission callback (`handlePermissionRequest`) is already how Otto arbitrates
tools, and the `dontAsk` allowlist (`applyDontAskAllowlist`) already **deliberately excludes
`Workflow`** while allowing `Task` — so unattended runs are covered today. The gap is attended
mode, where `Workflow` auto-runs like any in-model tool.

**Recommendation: gate, don't amputate.** Hard-disallowing `Workflow` contradicts the fork's
mission — we level capabilities up, we don't take a provider's native strength away. Instead:

- **Default posture: Ask first.** `Workflow` (and only `Workflow` — plain `Task` subagents stay
  ungated; they're small and already observed) triggers a permission prompt before executing,
  implemented as a permission rule / `canUseTool` interception rather than `disallowedTools`.
  The prompt names the cost shape ("Claude wants to start its own multi-agent workflow (N tasks);
  this runs outside Otto's orchestration caps") and — until the interrupt-kills-workflow behavior
  changes — warns that interrupting the session kills it.
- **Where the setting lives: host-level Claude provider setting** ("Provider-native workflows:
  Allow / Ask first / Off", default Ask first), with a **per-personality override** riding
  personality config for the two natural exceptions: an orchestrator personality that should
  never compete with the Otto runtime (Off), and a dedicated "ultracode crusher" personality
  (Allow). Host-level matches where provider behavior is configured; per-personality matches
  where spawn behavior is specialized. Not per-team — teams scope personalities, not models.
- **Explicit opt-ins bypass the ask.** Selecting the `ultracode` effort option **is** consent —
  the user picked a fan-out-branded option by hand ([docs/glossary.md](../../docs/glossary.md),
  Effort) — so that session gets Allow. Likewise an in-prompt "use Claude's Workflow" satisfied
  after one ask should be rememberable per-session via the normal permission-response semantics.

### (b) Route orchestration-intent at the Otto layer

The primary defense is structural, not a prompt patch: with the composer surface and
`/orchestrate` shipped, a user who wants an Orchestration never has to phrase it into chat at all
— intent is captured by Otto and lands as a typed spawn, before any model interprets anything.
Chat-phrased intent remains legitimate (emergent orchestration is the charter's thesis), but it
should resolve correctly too: amend `ORCHESTRATOR_METHOD_DIRECTIVE` with one sentence — when the
user asks for a run/orchestration, **`start_run` is the tool that means; never satisfy it with
provider-native workflow tools**. Non-orchestrator personalities get nothing new: for them the
Workflow ask-gate in (a) is the backstop, and the prompt it raises is itself the disambiguation
moment ("did you want an Otto orchestration instead?" is reasonable prompt copy).

### (c) Cost guardrails on every path

Regardless of how a fan-out starts, spending N agents needs opt-in:

- **Otto Orchestrations:** the runtime inserts an **implicit plan-approval gate before the first
  spawn** whenever the run was _model-initiated_ (emergent, no explicit user invocation) — the
  user sees the typed plan, the phase→member assignments, and the total planned agent count, and
  approves before anything spawns. Explicitly-invoked runs (sheet / `/orchestrate`) already carry
  the user's opt-in at the declared scale, so they proceed to the plan's own declared gates —
  **unless** declared fan-out exceeds a confirm threshold (default **5** candidates in flight;
  rides `DEFAULT_RUN_CAPS`), which re-raises the gate even on explicit runs. Autopilot never
  skips the model-initiated pre-spawn gate — autopilot is "don't pause at plan-declared gates",
  not "spend without asking".
- **Provider-native workflows:** the Ask-first prompt in (a) is the confirm. Otto cannot pre-count
  a Workflow's agents (the provider owns the plan), which is precisely why the prompt fires
  _before_ execution rather than at some spawn threshold.
- Both are daemon-enforced, matching the charter's posture that guardrails live structurally in
  the runtime, not in prose.

## Coexisting with provider-native workflows

Sometimes the user _does_ want Claude's ultracode/Workflow — it's a genuinely strong primitive.
How they say so, in order of explicitness:

1. **Pick the `ultracode` effort option** in the composer's Effort control — the designed,
   per-session opt-in (bypasses the ask-gate per (a)).
2. **Say it and approve the ask** — "use Claude's Workflow for this" → the Ask-first prompt →
   approve (optionally for the session).
3. **Set the personality/host posture to Allow** for a personality whose whole job is that.

Once running, a Workflow surfaces through the **observed-subagents track** as it does today
(`task_type: "local_workflow"` → an observed row titled `Workflow: <name>`, settled via
`task_notification`; see [projects/observed-subagents/observed-subagents.md](../observed-subagents/observed-subagents.md)).
Known gap, noted not solved here: **workflow rows render like plain Task subagent rows** — no
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
  tab that already _is_ the team's orchestrator may be reused — same resolution, zero surprise.
- **Ask-first default vs Allow for `Workflow`:** recommend **Ask first**. The incident shows the
  cost of silent Allow; Off by default contradicts the mission. Revisit if the ask proves noisy —
  the per-session remember should keep it to one prompt per intentional use.
- **Confirm threshold default:** recommend **5** in-flight candidates (the conductor's own target
  is ≥4 per the charter, so 5 keeps the standard shape prompt-free on explicit runs while
  catching runaway plans). Configurable alongside `maxAgents` in the sheet's Advanced section.
- **Do other providers need the same gate?** The design is provider-agnostic by construction —
  (a) generalizes to "any provider-native multi-agent primitive gets an Ask-first posture" (the
  observed-subagents provider-adapters work will enumerate them per provider); (b) and (c) are
  provider-blind already. Claude is the proof, per the fork's rule — a capability isn't done when
  one provider has it.
- **Should `/orchestrate` accept inline flags** (`--team`, `--autopilot`, `--max-agents`)?
  Recommend **not in v1** — the sheet is the escape hatch for non-defaults; flags can ride later
  without breaking anything.
