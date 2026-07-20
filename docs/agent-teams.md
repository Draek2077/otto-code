# Agent Teams

An **Agent Team** (UI label: "Agent teams", Host settings → Agents) is a named, per-host grouping of [agent personalities](agent-personalities.md) that acts as an **operating template** for the whole host: which personalities are on deck, and a shared **team prompt** that frames how they work together. A user can define many teams — "Shipping crew", "Research panel", "Solo + reviewer" — with any personalities in any of them (membership is many-to-many), but only **one team is active at a time**, and switching the active team is instant from the main UI.

Teams build directly on the Personalities system and reuse its invariants — stable ids, snapshot-at-spawn, availability, no-fallback hard-fails — rather than inventing new ones. Read [agent-personalities.md](agent-personalities.md) first. Teams shipped in 0.5.2. This doc is the durable architecture; the one remaining follow-up — the themed avatar image set — is tracked in [projects/todos/agent-teams-themed-avatars.md](../projects/todos/agent-teams-themed-avatars.md).

## What an active team does

When a team is active:

- **Pickers narrow to the team.** The personalities section in every picker (composer, artifact sheet, schedule sheet) shows only the active team's members — still role-filtered per surface, still availability-grayed. Raw provider/model selection is never filtered; teams scope _personalities_, not models.
- **Agents stack the team prompt.** An agent spawned from a member personality composes its system prompt with the team prompt directly ahead of the personality prompt (see [Prompt composition](#prompt-composition)).
- **The rest of the host follows.** Writer mini-task routing prefers team members; the Orchestrator's `list_personalities` enumerates the team.

**No active team = exactly legacy behavior.** The full roster shows everywhere and no team prompt stacks. "No team" is the implicit default, not an error — it degrades cleanly, the same shape as every other feature gate in the repo:

- **No personalities** (roster cleared): pickers show no personalities section at all — just the raw provider/model chooser; Writer routing runs the legacy chain; `list_personalities` returns empty.
- **Personalities but no teams**: everything works exactly as personalities ship. The Teams card shows its empty state; the main-window switcher does not render (it requires ≥ 1 team).
- **Teams exist but none active**: full roster in pickers, no team prompt, no scoping — teams are inert until activated. The switcher renders with "No team" selected.
- **Active team whose members are all deleted/unavailable**: the personalities section grays/empties per existing availability rules, and the raw chooser underneath is always reachable — a team can never brick agent creation.

North-star fit ([CLAUDE.md](../CLAUDE.md)): a team mixing an LM Studio Coder with a Claude Judger is a first-class team; nothing in the model, resolution, or prompt stacking is provider-specific.

## Data model

`agentTeams` is a section on `MutableDaemonConfig` (`packages/protocol/src/messages.ts`, alongside `agentPersonalities`, both `.passthrough()`). It holds `teams: AgentTeam[]` plus `activeTeamId: string | null` — the active team is **nested inside the same section**, not a top-level field, so a single patch replaces both together. It persists through `daemon-config-store.ts`'s merge whitelist and hot-reloads over `status:daemon_config_changed`. The capability flag is `features.agentTeams` — tagged `COMPAT(agentTeams): added in v0.5.2`.

```
AgentTeam {
  id: string                  // stable, machine-generated; the ONLY thing references bind to
  name: string                // human label, freely renamable, unique per host (case-insensitive)
  avatar?: {
    color?: string            // hex; the v1 avatar (swatch / colored ring)
    imageId?: string          // FUTURE themed-image key; wins over color when present, color is the fallback
  }
  teamPrompt?: string         // stacked ahead of the personality prompt at spawn
  memberIds?: string[]        // personality ids; order = display order in cards & pickers
}

agentTeams.activeTeamId?: string | null   // host-scoped; null/absent = no team active
```

- **On the wire everything past `id`/`name` is optional plain strings/arrays** — no enums, no transforms, `.passthrough()` containers — the same forward-compat posture as `AgentPersonalitySchema`. The daemon validates against its own roster when applying a patch. (The patch schema is declared explicitly rather than via `.partial()`: a `.partial()` variant would keep the `teams` `.default([])`, so an `activeTeamId`-only patch would inject an empty array and deep-merge would wipe the stored teams.)
- **Identity is the `id`, never the name.** Renaming a team must not break the active binding or any reference — same invariant as personalities.
- **Membership binds personality `id`s.** Renaming a personality changes nothing; a `memberIds` entry pointing at a deleted personality is **tolerated and ignored** everywhere (resolution, cards, pickers) and pruned opportunistically on the next save of that team. No eager cross-object cascades on delete. Deleting the **active** team clears `activeTeamId` in the same config patch — never a dangling active id.
- **The one cascade is opt-in and user-driven.** Deleting a team computes its **exclusive members** (`resolveExclusiveTeamMembers`, `packages/protocol/src/agent-teams.ts`) — members no _remaining_ team also lists, i.e. the personalities the delete would strand on no team at all — and, when that set is non-empty, the confirm dialog names them and offers an unchecked "Also delete these N personalities" checkbox. Checked, the roster and the teams array go out in **one config patch** so the two sections never briefly disagree. Unchecked (and always, when nothing would be stranded) the roster is untouched — the default stays "personalities are not deleted".
- **Avatar is colors-first, image-ready.** v1 ships only `avatar.color`. The themed image set lands later by adding `imageId` values and an app-side asset catalog — an additive field, zero protocol churn. Old clients that don't know `imageId` keep rendering the color; that is the designed degradation, not a fallback path.

### Why the active team is host-scoped daemon config (not device-local)

The team prompt is applied **daemon-side at spawn** — MCP `create_agent`, schedule runs, and mini-tasks all spawn with no client attached, so the daemon must know the active team on its own. Host config also gives the switcher its "instant everywhere" behavior for free: a patch from any client hot-reloads to every connected client via `status:daemon_config_changed`, same as every other config edit. A device-local active team would fork reality between phone and desktop and leave headless spawns teamless.

## Prompt composition

The one rule, applied at every spawn path (`composeTeamAndPersonalityPrompt`, `packages/server/src/server/agent/agent-teams.ts`):

> **If the spawning personality is a member of the active team at spawn time, the team prompt stacks directly ahead of the personality prompt.**

The personality-owned prompt composes top to bottom as **team prompt** (frames the collective) → **personality prompt** (specializes within it) → **role-focus directive** (`composeRoleFocusDirective`; tells a coordinator "orchestration is yours" or a focused worker "stay on task"). Then the existing global-append machinery runs unchanged (`applyDaemonAppendSystemPrompt`, `agent-manager.ts`), stacking the daemon-global `appendSystemPrompt` unless the personality set `respectGlobalAppendPrompt: false`. So the full stack: **provider base → team prompt → personality prompt → role directive → global append**. With no team layer and no roles the personality prompt passes through byte-identical to pre-teams behavior.

Deliberate boundaries of the rule:

- **Raw spawns (no personality) get no team prompt.** Teams are compositions of personalities; picking a raw provider/model is an explicit step outside the roster.
- **Non-member personality spawns get no team prompt.** Pickers only offer members while a team is active, so this arises only via an explicit MCP `create_agent personality:"X"` — explicit is explicit; the spawn succeeds without the team layer.
- **`respectGlobalAppendPrompt: false` does NOT suppress the team prompt.** That toggle governs the daemon-global append only. Putting a personality on a team opts it into the team frame; the team prompt is part of the identity stack, not the global append.
- **Empty/whitespace `teamPrompt` stacks nothing** — a team can be purely organizational (picker scoping) with no prompt.
- **Caller-authored prompts still win.** When the caller sets an explicit `systemPrompt`, neither the personality prompt nor the team prompt composes in — team prompt only rides the personality-owned prompt path.

### Snapshot semantics

At spawn the active team resolves to a frozen `ResolvedTeamSnapshot` (`{ teamId, name, avatarColor?, teamPrompt? }`) on `AgentSessionConfig.teamSnapshot`, persisted via `SERIALIZABLE_CONFIG_SCHEMA` next to `personalitySnapshot`. It mirrors the personality snapshot's lifecycle exactly:

- **Switching the active team never mutates a running or observed agent.** Agents keep the snapshot they were born with; switching changes only what _new_ spawns get, instantly, and nothing else.
- **A live personality switch keeps the born team.** `agent.personality.set` swaps only the personality layer; the prompt recomposes as `frozen teamSnapshot.teamPrompt + new personality prompt`. Switching to a personality outside the frozen team keeps the team prompt anyway — the agent's team is part of its birth identity, like its cwd.

The three daemon spawn paths that compose the team layer — interactive create (`session.ts` `applyPersonalityIdentityToConfig`), MCP `create_agent`, and schedule runs — all resolve through the one helper in `agent/agent-teams.ts` (`resolveTeamSnapshotForPersonality`), so the logic lives in one place. A schedule **resolves the active team at run time**, not at authoring time: a schedule that fires under Team B runs with Team B's framing (iff its bound personality is a member; otherwise no team layer — teamlessness is a valid state, never a hard-fail).

## What the active team gates (beyond the prompt)

- **Pickers** (`use-personality-selection.ts` / `combined-model-selector.tsx`): with a team active, the personalities section shows only members — **strict, no off-team group**. One exception: a schedule form editing a schedule already bound to an off-team personality keeps that bound entry selectable (it was valid when authored). The running-agent switcher also filters its pinned roster to team members, but the display-only entry for the _current_ personality keeps working when it's off-team so the trigger never lies.
- **Writer mini-task routing** (`resolveStructuredGenerationProviders`): available Writer **team members** are prepended ahead of available non-team Writers, which stay ahead of the legacy chain. This is a preference ladder, not an availability gate — an all-out-of-commission team must not break commit-message generation. (This is the one place "no fallback" does not apply; it never applied to mini-task routing.)
- **MCP `list_personalities`**: with a team active, returns members only, plus a note naming the active team (so an Orchestrator knows its bench). `create_agent` by explicit personality name still resolves the full roster — an Orchestrator can pull in an off-team specialist deliberately, it just won't carry the team prompt.
- **Role-matched daemon lookups** (Writer routing, `checkout.git.commit_agent`, etc.): prefer team members with the role, fall back to the full roster — same ladder as Writer routing.

Availability stays per-personality — a team is never "out of commission"; its members individually are.

### The "Team's &lt;Role&gt;" dynamic binding

Picker surfaces that pick a personality for a role offer a synthetic **"Team's &lt;Role&gt;"** entry alongside concrete personalities (the schedule form's **"Team's Scheduler"**, the artifact sheet's **"Team's Artificer"**), all built by the shared `buildTeamRoleEntry` (`packages/app/src/provider-selection/team-role-entry.ts`):

- **Binding semantics:** the surface owns how selection persists — a schedule stores a run-time **sentinel** (not a personality id) and re-resolves each run; an artifact just applies the resolved values now. At resolution the entry maps to the active team's **first available member carrying that role**, in `memberIds` order.
- **Hard-fail on the daemon side.** `resolveTeamSchedulerSnapshot` (`agent/agent-teams.ts`) throws a named error when no team is active, when the team has no member with the role, or when none are available — the same loud semantics as a bound personality being out of commission, never a silent fallback.
- **Form affordance:** the picker entry shows who it resolves to _right now_ ("currently Dash — changes with the active team").
- **Who gets picked by default** is `autoSelectDefault` on the shared producer (`useFormRolePersonality`). Create surfaces with no history of their own — new schedule, new artifact — pass `"always"`: the team entry wins outright, falling back to the first available personality carrying the role, and the device-local last-used personality is suppressed so it can't race. The new-chat composer passes `"fallback"`, where **the active team decides who arbitrates**: with a team active it behaves exactly like `"always"` (team entry wins, memory suppressed), and with no team active there is no default at all — nothing principled to pick, so the composer keeps whatever model it landed on and the device-local last-used personality is the only preselect, exactly as before teams existed.
  - **An active team always outranks device memory.** The team is an explicit, host-level choice; a last-used personality is a device-local leftover. Memory used to win here, and it was a one-way latch rather than a preference: the first personality pick wrote both `lastPersonalityByRole` and the device's last-used model, so the remembered entry matched on every subsequent draft and the team's holder could never auto-apply again — the team entry deliberately persists no last-personality, so nothing could ever clear it. The stated purpose of `"fallback"` (a fresh install with an active team opening on **"Team's Chatter"**) therefore survived exactly one click. Suppressing memory under a team is what makes that purpose hold for good.
  - This also closes a scoping hole: the remembered preselect resolved against the **full** roster while the up-front picker list is filtered to team members, so an off-team personality could be preselected into the trigger while being absent from the list behind it. Under a team, memory no longer runs at all.

## Team cards & editor (settings UI)

The **Agent teams** card (`agent-teams-section.tsx`) mounts in Host settings → Agents directly after the Personalities card, feature-gated on `features.agentTeams`, reading/writing via `useDaemonConfig` (the same hot-reload round-trip as personalities). Team cards show the avatar (v1: color swatch/ring), name + member count with a row of small spinner-color dots (one per member in each member's `glowA`), **role pills** (the union of all members' roles), an **Active** badge with "Set active" / "Deactivate" actions, and edit/delete. The `TeamEditModal` mirrors `PersonalityEditModal`'s invariants one-for-one: unique case-insensitive name, avatar color input, team-prompt textarea, a member checklist (≥ 1 member required, availability-graying that never blocks checking), double-submit lock, dirty-discard confirm, and concurrent-edit re-append safety. It is also tabbed the same way (`TabbedModalSheet`): **Identity** (name + team prompt), **Appearance** (avatar color), **Members** (the checklist). The Members tab pins a name/role filter in the sheet's `tabToolbar` slot — above the scroll region, so filtering stays reachable on a long roster — with a clear button that appears once there is something to clear.

## Main-window switcher

The "switch instantly from the main UI" surface is the `ActiveTeamSwitcher` (`packages/app/src/components/active-team-switcher.tsx`), rendered whenever the host advertises `features.agentTeams` and has ≥ 1 team. Its default home is a row in the top-left sidebar menu directly above "New workspace"; an appearance setting (`teamSwitcherPlacement`, `sidebar` | `header`) relocates it into the workspace title bar ahead of the other tools, styled like the tool dropdowns. Opening it lists all teams plus a "No active team" entry (current selection checked) and an "Edit teams…" footer deep-linking to Host settings → Agents.

Selection is **daemon truth**: picking a team patches `agentTeams.activeTeamId` via the daemon-config patch RPC and the control renders from the hot-reloaded config, so every connected client agrees instantly — there is no client-side selection state to drift. The control shows an in-flight spinner until `status:daemon_config_changed` echoes back. Switching is deliberately unceremonious (no confirm dialog); it affects only future spawns, so snapshot semantics make it as safe as changing a default.

## Starter team seed

A fresh host seeds `DEFAULT_AGENT_TEAMS` (`packages/protocol/src/default-personalities.ts`): one team, **"The Otto Crew"** (id `team_builtin_otto_crew`), containing the six starter personalities with a short team prompt about working as a coordinated crew. Seeding piggybacks the personalities' first-run/absent-section semantics (`daemon-config-store.ts`): the team is seeded only when the persisted `agentTeams` section is **absent**, so deleting it sticks across restarts. It is **seeded but NOT active** — `activeTeamId` stays unset on first run, so a fresh host behaves exactly like legacy Otto until the user opts in via the switcher (silently activating a prompt-bearing team on install would change spawn behavior out from under existing users). The card offers "Restore starter team" (restore-by-missing-builtin-id), and a guardrail test mirrors `default-personalities.test.ts`: every seeded `memberIds` entry must exist in `DEFAULT_AGENT_PERSONALITIES`.

## Where the code lives

- **Shared (app + daemon):** `packages/protocol/src/messages.ts` (`AgentTeamSchema`, `agentTeams` section + patch on `MutableDaemonConfig`, `features.agentTeams`), `packages/protocol/src/agent-teams.ts` (pure helpers: `getActiveAgentTeam`, `resolveTeamMembers`, `resolveExclusiveTeamMembers`, `isTeamMember`, `getEffectiveTeamPrompt`), `default-personalities.ts` (`DEFAULT_AGENT_TEAMS`).
- **Daemon:** `packages/server/src/server/agent/agent-teams.ts` (active-team resolution → `teamSnapshot`, `composeTeamAndPersonalityPrompt`, `resolveTeamSchedulerSnapshot`), `agent-manager.ts` (compose at spawn + `setAgentPersonality` recomposition), `session.ts` (`applyPersonalityIdentityToConfig`), `tools/otto-tools.ts` (`create_agent`/`list_personalities` scoping), `schedule/service.ts` (run-time team resolution), `structured-generation-providers.ts` (Writer team preference), `daemon-config-store.ts` (persistence + seed).
- **App:** `screens/settings/agent-teams-section.tsx` (card + `TeamEditModal`), `components/active-team-switcher.tsx` (switcher), `hooks/use-personality-selection.ts` + `components/combined-model-selector.tsx` (team filtering), `provider-selection/team-role-entry.ts` (`buildTeamRoleEntry`).

## Deferred

The **themed avatar image set** (charter step 7) is not built — an additive layer adding ~2 dozen app-bundled images, `avatar.imageId` catalog values, and a picker grid in the edit modal (the schema field already exists and degrades to the color avatar without it). Tracked in [projects/todos/agent-teams-themed-avatars.md](../projects/todos/agent-teams-themed-avatars.md).
