# Agent Teams — charter

Status: **PLANNED** (design drafted 2026-07-12, not yet locked). Builds directly on the shipped Agent Personalities system ([docs/agent-personalities.md](../../docs/agent-personalities.md)); read that first — Teams reuses its invariants (stable ids, snapshot-at-spawn, availability, no-fallback hard-fails) rather than inventing new ones.

## What this is

An **Agent Team** is a named, per-host grouping of agent personalities that acts as an **operating template** for the whole host: which personalities are on deck, and a shared **team prompt** that frames how they work together. A user can define many teams — "Shipping crew", "Research panel", "Solo + reviewer" — with any personalities in any of them (membership is many-to-many), but only **one team is active at a time**, and switching the active team is instant from the main UI.

When a team is active:

- **Pickers narrow to the team.** The personalities section in every picker (composer, artifact sheet, schedule sheet) shows only the active team's members (still role-filtered per surface, still availability-grayed). Raw provider/model selection is never filtered — teams scope _personalities_, not models.
- **Agents stack the team prompt.** An agent spawned from a member personality composes its system prompt as **Team Prompt + Personality Prompt** (in that order), with the daemon-global `appendSystemPrompt` still stacking per the personality's existing `respectGlobalAppendPrompt` rule. The user-facing story: _System Prompt + Team Prompt + Agent Prompt_.
- **The rest of the host follows.** Writer mini-task routing prefers team members; the Orchestrator's `list_personalities` enumerates the team.

No active team = exactly today's behavior. The full roster shows everywhere, no team prompt stacks. "No team" is the implicit default state, not an error.

### Zero-setup invariant (nothing configured = legacy behavior)

The whole personalities + teams layer is **strictly opt-in and layered**. Each layer degrades cleanly to the one below, and with nothing set up the app is indistinguishable from pre-personalities Otto:

- **No personalities** (user cleared the roster): pickers show no personalities section at all — just the legacy raw provider/model chooser (including the single-provider bypass); Writer/mini-task routing runs the legacy chain; `list_personalities` returns empty. This is already shipped behavior — teams must not disturb it.
- **Personalities but no teams**: everything works exactly as personalities ship today. The Teams settings card shows its empty state; the main-window switcher does not render (it requires ≥ 1 team); no team logic runs anywhere.
- **Teams exist but none active**: full roster in pickers, no team prompt, no scoping — teams are inert until activated. The switcher renders with "No team" selected.
- **Active team whose members are all deleted/unavailable**: the personalities section grays/empties per existing availability rules, and the raw chooser underneath is always reachable — a team can never brick agent creation.

No special-case code paths implement this: it falls out of "absent section ⇒ no section rendered" and "no active team ⇒ no team logic," the same shape as every other feature gate in the repo. Every build step below must keep this true (tests assert the empty-roster and no-team paths).

North-star fit ([CLAUDE.md](../../CLAUDE.md)): provider-agnostic from day one. A team mixing an LM Studio Coder with a Claude Judger is a first-class team; nothing in the model, resolution, or prompt stacking is provider-specific.

## Data model

A new `agentTeams` section on `MutableDaemonConfig` (`packages/protocol/src/messages.ts`, alongside `agentPersonalities`), plus a sibling `activeAgentTeamId`. Persisted through `daemon-config-store.ts`'s merge whitelist, hot-reloaded over `status:daemon_config_changed`. Capability flag `features.agentTeams`, tagged `COMPAT(agentTeams)`.

```
AgentTeam {
  id: string                  // stable, machine-generated; the ONLY thing references bind to
  name: string                // human label, freely renamable, unique per host (case-insensitive)
  avatar?: {
    color?: string            // hex; the v1 avatar (swatch / colored ring)
    imageId?: string          // FUTURE: key into the shipped themed avatar set (~2 dozen images);
  }                           //         when present it wins over color, color stays the fallback
  teamPrompt?: string         // stacked ahead of the personality prompt at spawn
  memberIds: string[]         // personality ids; order = display order in cards & pickers
}

activeAgentTeamId?: string | null   // host-scoped; null/absent = no team active
```

- **On the wire everything is optional plain strings/arrays** past `id`/`name` (same forward-compat posture as `AgentPersonalitySchema` — no enums, no transforms, `.passthrough()` containers). The daemon validates against its own roster when applying a patch.
- **Identity is the `id`, never the name.** Renaming a team must not break the active-team binding or any future reference. Same invariant as personalities.
- **Membership binds personality `id`s.** Renaming a personality changes nothing; a `memberIds` entry pointing at a deleted personality is **tolerated and ignored** everywhere (resolution, cards, pickers) and pruned opportunistically on the next save of that team. No eager cross-object cascades on delete.
- **Avatar is colors-first, image-ready.** v1 ships only `avatar.color` (hex, validated like spinner colors). The themed image set lands later by adding `imageId` values and an app-side asset catalog — an additive field, zero protocol churn. Old clients that don't know `imageId` keep rendering the color; that's the designed degradation, not a fallback path.

### Why `activeAgentTeamId` is host-scoped daemon config (not device-local)

The team prompt is applied **daemon-side at spawn** — MCP `create_agent`, schedule runs, and mini-tasks all spawn with no client attached, so the daemon must know the active team on its own. Host config also gives us the switcher's "instant everywhere" behavior for free: a patch from any client hot-reloads to every connected client via `status:daemon_config_changed`, same as every other config edit. A device-local active team would fork reality between the phone and the desktop and leave headless spawns teamless. (If a per-device _view_ preference ever matters, that's a separate future field — the operating template is host truth.)

## Prompt composition (the core semantic)

The one rule, applied at every spawn path:

> **If the spawning personality is a member of the active team at spawn time, the team prompt stacks directly ahead of the personality prompt.**

Composed agent `systemPrompt` = `teamPrompt + "\n\n" + personalityPrompt` (team frames the collective, personality specializes within it). Then the existing global-append machinery runs unchanged: `applyDaemonAppendSystemPrompt` (`agent-manager.ts`) stacks the daemon-global `appendSystemPrompt` unless the personality set `respectGlobalAppendPrompt: false`. So the full stack, top to bottom: **provider base → team prompt → personality prompt → global append**.

Deliberate boundaries of the rule:

- **Raw spawns (no personality) get no team prompt.** Teams are compositions of personalities; picking a raw provider/model is an explicit step outside the roster and behaves exactly like today.
- **Non-member personality spawns get no team prompt.** Pickers only offer members while a team is active, so this arises only via explicit MCP `create_agent personality:"X"` — explicit is explicit; the spawn succeeds without the team layer.
- **`respectGlobalAppendPrompt: false` does NOT suppress the team prompt.** That toggle governs the daemon-global append only. A user who put a personality on a team has opted it into the team frame; the team prompt is part of the identity stack, not the global append. (Design decision — revisit only if a real personality needs to opt out, in which case it should probably just not be on the team.)
- **Empty/whitespace `teamPrompt` stacks nothing** — a team can be purely organizational (picker scoping) with no prompt.

### Snapshot semantics (mirrors personalities exactly)

At spawn, the active team resolves to a frozen **`teamSnapshot`** on `AgentSessionConfig` — `{ teamId, name, avatarColor?, teamPrompt? }` — persisted via `SERIALIZABLE_CONFIG_SCHEMA` next to `personalitySnapshot`.

- **Switching the active team never mutates a running or observed agent.** Same hard rule as personality edits: agents keep the snapshot they were born with. Switching teams changes what _new_ spawns get, instantly, and nothing else.
- **Live personality switch keeps the born team.** `agent.personality.set` swaps only the personality layer; the prompt recomposes as `frozen teamSnapshot.teamPrompt + new personality prompt` (extend the existing prompt-ownership recomposition at `agent-manager.ts` `setAgentPersonality`). Switching to a personality outside the frozen team keeps the team prompt anyway — the agent's team is part of its birth identity, like its cwd. Clearing the personality keeps brain + team, drops the personality prompt (existing rule, team layer added).
- **Caller-authored prompts still win.** The existing prompt-ownership rule is untouched: when the caller sets an explicit `systemPrompt`, neither the personality prompt nor the team prompt is composed in. Team prompt only rides the personality-owned prompt path.

### Spawn paths that must compose (checklist)

All three resolve through the daemon, so the logic lives in one place (the resolution module, below), not scattered:

1. **Interactive create** — `session.ts` `applyPersonalityIdentityToConfig` (the composer's `personality` field on `CreateAgentRequestMessageSchema`).
2. **MCP `create_agent`** — `resolveCreateAgentBrain` in `otto-tools.ts`.
3. **Schedule runs** — `schedule/service.ts` `executeSchedule` / `resolveSchedulePersonalityBrain`. A schedule **resolves the active team at run time**, not at authoring time: the active team is "how this host operates right now," and a schedule that fires under Team B runs with Team B's framing (iff its bound personality is a member; otherwise no team layer — never a hard-fail, unlike personality unavailability, because teamlessness is a valid state). Flagged as an open decision below since snapshot-at-authoring is defensible too.

Mini-tasks (Writer routing) do **not** get the team prompt — they are structured one-shot generations with purpose-built prompts, not conversational agents. The team affects only _which_ Writer is preferred (below).

## What the active team gates (beyond the prompt)

- **Pickers** (`usePersonalitySelection` / `CombinedModelSelector`): with a team active, the personalities section shows only members (role- and availability-filtered as today). Selected-but-now-filtered edge: a remembered `lastPersonalityByRole` id outside the team simply fails the existing match-gate and doesn't restore. The running-agent switcher (`useRunningChatPersonality`) also filters its pinned roster to team members — but the synthesized display-only entry for the _current_ personality keeps working when it's off-team, so the trigger never lies.
- **Writer mini-task routing** (`resolveStructuredGenerationProviders`): available Writer **team members** are prepended ahead of available non-team Writers, which stay ahead of the legacy chain. Routing is a preference ladder, not an availability gate — an all-out-of-commission team must not break commit-message generation. (This is the one place "no fallback" doesn't apply: it never applied to mini-task routing, which is explicitly a preference chain.)
- **MCP `list_personalities`**: with a team active, returns members only, plus a note naming the active team (so an Orchestrator knows its bench). `create_agent` by explicit personality name still resolves the full roster — the Orchestrator can pull in an off-team specialist deliberately, it just won't carry the team prompt.
- **Commit-agent resolution and every other role-matched daemon lookup** added since (e.g. `checkout.git.commit_agent`): prefer team members with the role, fall back to the full roster — same ladder as Writer routing.

Nothing else changes. Availability stays per-personality (a team is never "out of commission" — its members individually are). Schedules bound to a personality keep their existing hard-fail semantics on personality unavailability.

## Team cards & editor (settings UI)

A new **Agent teams** card (`agent-teams-section.tsx`) in Host settings → Agents, mounted **directly after** `AgentPersonalitiesSection` in `host-page.tsx` (~line 290), feature-gated on `features.agentTeams`. Reads/writes via `useDaemonConfig` — same hot-reload round-trip as personalities.

**Team cards** show:

- avatar (v1: color swatch/ring; later: themed image),
- name + member count, with member identity hinted by a row of small spinner-color dots (one per member, in each member's `glowA`) — cheap, readable, already-owned visual language,
- **role pills**: the union of all members' roles (normalized via the shared helpers in `protocol/agent-personalities.ts`). Optionally (polish, not v1-blocking): missing roles rendered as ghost pills so coverage gaps are visible at a glance ("this team has no Judger"),
- an **Active** badge on the active team, with a "Set active" action on the others (and "Deactivate" on the active one → no team),
- edit / delete actions. Deleting the **active** team clears `activeAgentTeamId` in the same config patch (never leave a dangling active id). Delete confirms.

**Edit dialog** (`TeamEditModal`, mirroring `PersonalityEditModal`'s invariants one-for-one):

- name field — **unique case-insensitive** across teams, inline error, excludes self,
- avatar **color input** (wheel + hex text, validated like spinner colors) with live swatch preview,
- **team prompt** textarea with a one-line explainer of the stack ("Added before each member's personality prompt"),
- **member checklist**: every personality as a check row — name, static spinner-color chip, role pills, availability graying with reason (shared `checkPersonalityAvailability`). Checking is never blocked by unavailability (a team can include a currently-offline LM Studio member; it grays in pickers as usual). Require **≥ 1 member** to save,
- double-submit lock, dirty-discard confirm (stringify check), concurrent-edit re-append safety — copy the personality modal's behaviors exactly.

Follow [docs/forms.md](../../docs/forms.md), [docs/floating-panels.md](../../docs/floating-panels.md), and the icon-button-tooltips rule. i18n: English-only until verified, locale files kept type-parity (house rule).

## Main-window team switcher

The "switch instantly from the main UI" surface. Proposed shape (final placement to confirm at build time with a mock):

- a compact **team chip** (avatar + team name; "No team" state shows a neutral glyph) in the main window header region, visible whenever the host advertises `features.agentTeams` and has ≥ 1 team,
- tapping opens an anchored popover (per [docs/floating-panels.md](../../docs/floating-panels.md)) listing all teams — avatar, name, role-pill strip, member dots — plus a **"No team"** entry, current selection checked,
- selecting patches `activeAgentTeamId` via the existing daemon-config patch RPC; the popover shows an in-flight spinner until `status:daemon_config_changed` echoes back. No client-side selection state — the chip renders from the hot-reloaded config, so all clients agree instantly,
- an "Edit teams…" footer row deep-links to Host settings → Agents.

Switching is deliberately **unceremonious** — no confirm dialog. It affects only future spawns (snapshot semantics protect everything running), so it's as safe as changing a default.

## Starter team seed

Extend the existing starter-roster seeding: `DEFAULT_AGENT_TEAMS` next to `DEFAULT_AGENT_PERSONALITIES` in `packages/protocol/src/default-personalities.ts` — one team, **"The Otto Crew"** (id `team_builtin_otto_crew`), containing all six starter personalities, avatar color picked from the theme, and a short team prompt about working as a coordinated crew under Atlas.

- Seeding piggybacks the same first-run/absent-section semantics (`seedDefaultPersonalitiesIfAbsent` pattern in `daemon-config-store.ts`): seed only when the persisted `agentTeams` section is **absent**, so deleting the team sticks across restarts.
- **Seeded but NOT active.** `activeAgentTeamId` stays unset on first run, so a fresh host behaves exactly like today until the user opts in via the switcher. Activating a prompt-bearing team silently on install would change spawn behavior out from under existing users.
- The settings card gets "Restore starter team" empty-state/footer affordances mirroring the personalities editor (restore-by-missing-builtin-id).
- Guardrail test mirrors `default-personalities.test.ts`: every seeded `memberIds` entry must exist in `DEFAULT_AGENT_PERSONALITIES`.

## Where the code lives (file map)

- **Protocol:** `packages/protocol/src/messages.ts` (`AgentTeamSchema`, `agentTeams` + `activeAgentTeamId` on `MutableDaemonConfigSchema` + patch, `features.agentTeams`), `packages/protocol/src/agent-teams.ts` (pure helpers: member resolution, role-union, active-team lookup — shared app + daemon), `default-personalities.ts` (seed).
- **Daemon:** `daemon-config-store.ts` (merge whitelist + seed), `bootstrap.ts` (seed call, `onFieldChange` wiring), `server/agent/agent-teams.ts` (resolve active team → `teamSnapshot`; prompt composition helper used by all three spawn paths), `agent-manager.ts` (compose at `prepareSessionConfig`-adjacent spawn path + `setAgentPersonality` recomposition), `session.ts` (`applyPersonalityIdentityToConfig`), `tools/otto-tools.ts` (`create_agent`, `list_personalities` scoping), `schedule/service.ts` (run-time team resolution), `structured-generation-providers.ts` (Writer team preference).
- **App:** `screens/settings/agent-teams-section.tsx` (card + `TeamEditModal`), `host-page.tsx` (mount), `hooks/use-personality-selection.ts` + `combined-model-selector.tsx` (team filtering), the switcher component (placement TBD) + its popover, `runtime/host-features.ts` (gate).

## Build sequence

1. **Schema + persistence + capability flag.** `agentTeams`/`activeAgentTeamId` on config (protocol + store merge whitelist + hot reload), `features.agentTeams` emitted with COMPAT tag, shared helpers module. Round-trips to disk, survives restart, delete-active clears the id. Tests: config-store round-trip, absent-vs-empty, active-id healing. No UI yet.
2. **Resolution + prompt composition.** `server/agent/agent-teams.ts`: active-team resolution, `teamSnapshot` on `AgentSessionConfig` (+ `SERIALIZABLE_CONFIG_SCHEMA`, round-trip test), the one composition helper, wired into all three spawn paths + the live personality-switch recomposition. Unit tests: member/non-member/raw spawns, empty prompt, respect-global-append interplay, caller-authored prompt wins, snapshot frozen across team switch.
3. **Teams editor card.** Cards (avatar, name, member dots, role-pill union, Active badge, set-active/deactivate, delete-clears-active) + `TeamEditModal` with the full personality-modal invariant set. English-only strings.
4. **Active-team gating.** Picker filtering (all three surfaces + running-agent switcher pinning), Writer/mini-task team preference, `list_personalities` scoping + active-team note. Tests on the routing ladder.
5. **Main-window switcher.** Chip + popover, config-patch activation, in-flight state, "No team" entry, settings deep-link. Placement confirmed with the user against a quick mock first.
6. **Starter team seed + restore.** `DEFAULT_AGENT_TEAMS`, seeding, restore affordances, guardrail test.
7. **(Later, separate)** Themed avatar image set: ~2 dozen app-bundled images + `avatar.imageId` catalog + picker grid in the edit modal. Purely additive.

Steps 1–2 are daemon work (rebuild + restart to serve); 3–5 are mostly client. 4 has small daemon pieces. Each step lands typecheck/lint/format green with its tests.

## Open decisions (to confirm before or during build)

1. **Schedule team resolution: run-time vs authoring-time.** Plan says run-time (active team = current host operating mode). Alternative: snapshot the team onto the schedule at authoring for reproducibility. Run-time is the default unless the user prefers frozen schedules.
2. **Switcher placement.** "Main UI window somewhere" — header chip proposed; confirm against the actual header density (desktop vs compact form factor may want different homes, e.g. chip on desktop, entry in the workspace menu on phones).
3. **Picker escape hatch.** Strict member-filter proposed (switch/deactivate to see everyone). Alternative: a collapsed "Not on this team" group in pickers. Start strict; add the group only if real usage misses off-team personalities mid-flow.
4. **Off-team live personality switch keeps the team prompt** (born-team-is-frozen rule). Confirm this reads right in practice; the alternative (dropping the team layer when switching off-team) makes prompt state depend on switch history, which is worse.
5. **Ghost pills for missing roles** on team cards — polish; include in step 3 only if cheap.
