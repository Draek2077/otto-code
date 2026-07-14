# Agent Personalities

An **agent personality** (UI label: "Agent personalities", Host settings → Agents) is a named, reusable agent template stored per-host in the daemon config. It is the primary way a user picks "who does the work": instead of choosing a raw provider + model + effort + mode every time, they pick a personality once and it fills all of that in — on a local LM Studio model just as much as a frontier API. This is the provider-agnostic leveling-up pattern from [CLAUDE.md](../CLAUDE.md): a personality bound to a local model is as capable a Chatter or Judger as one bound to a hosted API.

Personalities shipped in 0.5.0. This doc is the durable architecture. The one open product decision — persisting a client schedule-form personality binding — is tracked in [projects/todos/schedule-form-personality-binding.md](../projects/todos/schedule-form-personality-binding.md).

## What a personality binds

Each personality bundles a **brain** and an **identity**:

- **provider → model** pair,
- a **canonical effort level** (`off`…`max`), resolved to the model's nearest advertised option at spawn (see [glossary Effort](glossary.md), `packages/protocol/src/effort.ts`),
- a **default permission mode** (provider-scoped),
- a **personality prompt** (fills the per-agent `systemPrompt`),
- a **`respectGlobalAppendPrompt`** toggle (whether the daemon-wide `appendSystemPrompt` still stacks on top; `false` = the personality prompt stands alone),
- one or more **roles**,
- an **identity**: a name, two spinner colors, and an optional **TTS voice** (spoken identity).

## Data model

`agentPersonalities` is a section on `MutableDaemonConfig` (`packages/protocol/src/messages.ts`, alongside `MutableDaemonConfigSchema` / its patch variant, both `.passthrough()`). It persists through `daemon-config-store.ts`'s merge whitelist and hot-reloads over `status:daemon_config_changed`. The capability flag is `features.agentPersonalities` on `ServerInfoStatusPayloadSchema.features` — tagged `COMPAT(agentPersonalities)`.

```
AgentPersonality {
  id: string                    // stable, machine-generated; the ONLY thing references bind to
  name: string                  // human label, freely renamable, unique per host
  provider: string              // provider id (e.g. "codex", "openai-compat")
  model: string                 // provider-scoped model id
  effortLevel: EffortLevel      // canonical: off|minimal|low|medium|high|xhigh|max
  modeId: string                // default permission mode (provider-scoped)
  personalityPrompt?: string    // → per-agent systemPrompt
  respectGlobalAppendPrompt: boolean   // default true
  roles: PersonalityRole[]      // one or more
  spinner: { glowA: string; glowB: string }         // two hex colors for BlobLoader
  voice?: { provider: string; model: string; name: string }  // TTS voice; soft binding
}
```

This is the logical shape; on the wire everything past `provider`/`model` is an optional plain string (`AgentPersonalitySchema`, `messages.ts` — no enums) for forward compat, and the daemon validates values against its own catalog when applying a patch.

Two invariants:

- **Identity is the `id`, never the `name`.** Renaming a personality must not break any schedule, remembered picker selection, or in-flight agent. Everything binds `id`.
- **Effort is stored canonical, resolved at spawn.** Store the `EffortLevel`, never a raw `thinkingOptionId` (option ids differ per model). Resolve against the bound model at spawn with `resolveEffortOption` (`packages/protocol/src/effort.ts`; `packages/server/src/server/agent/effort-levels.ts` re-exports).

## Roles (8)

A personality carries one or more roles. Roles gate where a personality shows up. A new personality defaults to **all roles**; the editor has an All / None toggle.

| Role             | Consumed by                                                                                                         | App picker surface today                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Chatter**      | Interactive agent chats                                                                                             | Composer agent-controls picker                     |
| **Artificer**    | Creating & managing artifacts                                                                                       | Artifact create sheet                              |
| **Scheduler**    | Creating & managing schedules                                                                                       | Schedule form sheet                                |
| **Writer**       | Fast small-text generation — commit messages, PR text, branch/workspace names (mini-tasks)                          | None (daemon-internal, see below)                  |
| **Coder**        | Spawned as a coding sub-agent (incl. text-editor AI refactor)                                                       | None yet — via skills / MCP                        |
| **Judger**       | Judging / review passes                                                                                             | None yet — via committee / review skills           |
| **Advisor**      | Planning / second opinion; **read-only / advisory**                                                                 | None yet — via advisor / committee skills          |
| **Orchestrator** | Drives multi-agent workflows. **Semantic label only** — enumerating & spawning personalities is open to every agent | None yet — via committee / panels / handoff / loop |

The role catalog lives in `PERSONALITY_ROLES` and the shared predicate/helpers in `packages/protocol/src/agent-personalities.ts` (used by both app pickers and the daemon).

### Role tiers: coordinators vs focused workers

Roles fall into two behavioral **tiers** (`PERSONALITY_ROLE_INFO` in `agent-personalities.ts`):

- **Coordinators** — **Chatter, Artificer, Scheduler, Advisor, Orchestrator.** They converse, plan, and delegate; they're expected to enumerate the roster and launch other agents/personalities to get work done.
- **Focused workers** — **Writer, Coder, Judger.** They lift a single thing someone is waiting on and should stay on task, not fan out into sub-agents.

A personality that carries **any** coordinator role is a coordinator (`personalityCanLaunch` — a `chatter + coder` both codes and delegates); one whose roles are entirely focused (or roleless) is a focused worker.

**This is guidance, not a gate.** Every agent keeps the same tools — `list_personalities` and personality-named spawns are open to all (that's the "see and understand each other" property). The tier only drives two in-context nudges:

- **A spawn-time role directive** (`composeRoleFocusDirective`) folded into the personality's system prompt at spawn: coordinators are told "orchestration is yours"; focused workers are told "someone is waiting on this — stay on it, don't spawn sub-agents unless essential."
- **`list_personalities` decision-aid fields** — every entry carries `tier`, `canLaunch`, and a `guidance` "why you'd choose me" blurb (joined from its roles' taglines), so a deciding agent self-selects the right teammate from the list alone.

**Writer and Coder replaced the old single `Worker` role.** Worker split into the fast small-text tier (`writer`) and the coding sub-agent tier (`coder`). A personality persisted with the retired `worker` tag resolves to `coder` via `LEGACY_ROLE_ALIASES` in `agent-personalities.ts` — normalization maps it before filtering, so no personality silently loses its role. Roles still ride the wire as plain strings, so old peers keep parsing.

### Writer routing (mini-tasks prefer a personality first)

Daemon-internal mini-tasks — commit messages, PR title/body, and branch/workspace name generation — resolve their model through `resolveStructuredGenerationProviders` (`packages/server/src/server/agent/structured-generation-providers.ts`). When a caller passes `role: "writer"`, every **available** Writer personality (checked against the live provider snapshot with the same `checkPersonalityAvailability` predicate the pickers use) is resolved to a concrete provider/model/effort and **prepended ahead of the legacy chain** (explicit `metadataGeneration.providers` config → built-in substring preference list → current selection → hardcoded string). So a user's Writer personality is the primary worker for these tasks; the legacy substring list is the fallback that only runs when no Writer is available or all of them fail. The personality's canonical effort resolves to the model's nearest advertised thinking option here, exactly as at spawn. The two callers that pass `role: "writer"` are `git-metadata-generator.ts` (commit + PR) and `worktree-branch-name-generator.ts` (titles + branches); the roster reaches the resolver through `StructuredGenerationDaemonConfig.agentPersonalities`.

## Availability ("out of commission")

A personality is **available on a given host + workspace (cwd)** only if every bound setting resolves against the live providers snapshot there: the provider is present/enabled/authenticated, the bound model exists in that provider's snapshot, and the bound `modeId` exists among that provider's modes. Availability is evaluated against `provider-snapshot-manager.ts` / `use-providers-snapshot.ts`.

If any check fails the personality is **out of commission**:

- **In pickers:** grayed out with a reason ("Blaze — LM Studio not connected"), not selectable.
- **In automation (schedules, spawn-by-name):** a **hard-fail with a visible, named error.** No fallback to another model or provider — this follows the repo's no-fallback-paths rule. A schedule pointed at an out-of-commission personality fails its run loudly rather than silently substituting.

The voice is the one exception: it is a **soft binding** and never gates availability — an unresolvable voice degrades to the host default at playback.

A personality that omits `modeId` inherits the provider's default mode — but resolution validates that fallback against the provider's live modes catalog before using it (`resolveFallbackModeId`, `agent-personalities.ts`). A provider's advertised `defaultModeId` can go stale relative to its modes; availability only checks the personality's _own_ `modeId`, so an unvalidated fallback would pass resolution and then throw inside `setMode` at apply time. When the fallback is itself absent from the catalog, resolution drops it and the provider picks its own default.

## Resolution & lifecycle

**Spawn snapshots the personality onto the agent.** At spawn the personality resolves to a concrete blob — `ResolvedPersonalitySnapshot` (`packages/server/src/server/agent/agent-personalities.ts`) — stored as `AgentSessionConfig.personalitySnapshot` and persisted via `SERIALIZABLE_CONFIG_SCHEMA`. From then on the agent is frozen to its snapshot.

- **Editing a personality never mutates an in-flight or observe-only agent.** Running streams and read-only observed agents keep the snapshot they were born with — there is no automatic re-resolution, next-turn or otherwise. The only way an existing agent picks up roster edits is an explicit live switch (below), which re-resolves the personality fresh; re-selecting the same personality via the switcher is how you pull edits into a running chat.
- **New jobs re-resolve.** Any fresh spawn picks up the current (edited) settings.

**Override semantics.** Selecting a personality in a picker fills the underlying provider/model/effort/mode fields; the user may hand-edit any of them (an explicit per-field override) and **the agent keeps the personality identity** (name, spinner colors, prompt) with the overridden brain layered on. Only an explicit "clear personality" detaches back to a plain provider/model selection. In tooling, the template applies verbatim and a caller may override individual fields **only when explicitly requested** — no heuristic substitution.

## Live switch (running agents)

A RUNNING chat agent can be switched to another personality — or cleared — without losing its conversation.

**RPC + gate.** `agent.personality.set.request` / `.response` (`packages/protocol/src/messages.ts`): `agentId` + nullable `personalityId` (null = clear). Gated by `server_info.features.setAgentPersonality`, tagged `COMPAT(setAgentPersonality)` — an old daemon simply doesn't advertise the flag and the app hides the switcher entirely; there is no fallback path.

**Strict resolution.** The session shell (`Session.resolvePersonalitySnapshotForAgent`, `session.ts`) re-resolves the roster id against the agent's cwd before applying. Unlike spawn's soft-skip (`applyPersonalityIdentityToConfig` logs and spawns without identity), the live switch **rejects the RPC** when the personality is unknown or out of commission, surfacing the unavailability reason. It warms only the personality's own provider snapshot so a cold workspace doesn't fan out network probes to every provider.

**Daemon semantics** (`AgentManager.setAgentPersonality`, `agent-manager.ts`). The switch applies the full personality atomically in one request:

- **Brain** (model/mode/effort) rides the existing live-session setters (`setModel`/`setMode`/`setThinkingOption`) — applied only when _binding_; **clearing keeps the brain** (model, mode, and effort stay as they are).
- **Prompt** goes through the provider session's optional `applyPersonality` (`AgentSession`, `agent-sdk-types.ts`). Providers that don't implement it (they can't change a system prompt mid-conversation) **reject cleanly** before anything is applied. A personality bound to a different provider than the agent's also rejects.
- **Identity** (name/spinner) follows automatically: the resolved snapshot persists as `config.personalitySnapshot`, and `agent_state` projects `personalityId`/`personalityName`/`personalitySpinner` from it.
- **Serialization:** config mutations on one agent (personality set, model/mode/effort/feature changes) run through a per-agent promise-chain lock in `AgentManager`, so two racing RPCs can't interleave into a mixed half-and-half state.
- **Prompt ownership** mirrors spawn: the personality prompt only owns `config.systemPrompt` when the caller set none at spawn (or it equals the outgoing personality's prompt) — a caller-authored prompt survives switches. `respectGlobalAppendPrompt === false` drops the daemon-global append prompt, same rule as at spawn.

**Provider differences.** Claude bakes the system prompt into the query options, so `applyPersonality` flags a **lazy query restart**: the change lands on the next turn, resuming the same session id; if a turn is active the RPC returns an "applies next turn" provider notice. The openai-compat provider owns its conversation (`messages[0]` is the system prompt, re-sent every request), so it rebuilds the prompt in place — no restart needed.

**App flow** (`useRunningChatPersonality`, `packages/app/src/composer/agent-controls/index.tsx`). On a running chat agent, the model picker's provider-family menu pins roster personalities that have the **Chatter** role and match the agent's provider family, filtered by the picker's search box on name. Picking one shows a warning dialog (switches prompt, model, mode, effort; applies next turn) with a "Don't show this again" checkbox persisted as a device-local form preference. While the RPC is in flight the model trigger shows a spinner and the composer locks send/dictation/voice-mode (typing and attachments stay enabled), with a 30-second timeout that re-enables the controls if the daemon doesn't answer. Picking a **raw model** while a personality is bound shows one combined confirm and then clears the personality and applies the model as a single locked flow — the personality detaches and its prompt reverts per the ownership rule. Selection keys on `agent_state.personalityId` (stable across renames), with a `personalityName` match as the fallback against daemons that predate the field; there is no client-side selection state to drift. When the bound personality can't be found in the selectable roster (deleted, renamed on an old daemon, Chatter role removed, or the daemon predates the live switch), the picker synthesizes a display-only entry from `agent_state` so the trigger keeps the truthful name + spinner.

The RPC shares the per-agent config envelope in `AgentConfigSession` (`packages/server/src/server/session/agent-config/agent-config-session.ts`): success returns any provider notice, failure emits an `activity_log` error frame plus the rejected response.

## Identity (spinner + voice)

- **Spinner:** the personality's two colors ride onto the agent's live thinking indicator (`BlobLoader`, `packages/app/src/components/blob-loader.tsx`) via the additive `AgentSnapshotPayload.personalitySpinner` (absent ⇒ theme default). This is the first per-agent color path for the live spinner. The composer/tab trigger shows the provider glyph filled with the two colors as a static 45° gradient (`PersonalityProviderIcon`); the left sidebar stays theme-generic by design.
- **Voice:** a per-utterance `SpeechVoiceOverride` threads through `synthesizeSpeech(text, voice?)` → `TTSManager` → the provider. Sherpa resolves the voice name to a local speaker id (soft binding); OpenAI honors a valid OpenAI voice name. A personality agent speaks in its own voice in realtime voice mode. See [voice architecture](../public-docs/voice.md).

## Otto tooling

Personalities are first-class in the agent-management MCP tools, so multi-agent skills can say "spawn a Worker and a Judger" without hardcoding providers:

- **`create_agent`** gained an optional `personality` arg (by name; one of provider/personality required). It resolves against the caller cwd's provider snapshot and expands to provider/model/effort/mode/systemPrompt; explicit sibling fields override per-field. Hard-fails when the personality is missing or out of commission.
- **`list_personalities`** enumerates the roster (name, roles, availability, resolved brain, plus the `tier`/`canLaunch`/`guidance` decision-aid). **Open to every agent** — personalities are aware of each other, and any agent can enumerate the roster and spawn any personality by name (personality-named spawns are just another way to pick a provider/model/effort). No role gates this; the coordinator/focused tier only steers behavior in-context (see [Role tiers](#role-tiers-coordinators-vs-focused-workers)).
- **`create_schedule` / `update_schedule`** accept a `personality` arg; a bound schedule re-resolves against the run's workspace each run and hard-fails on unavailability.

Separately from the MCP tools, the **`agentPersonalities.get_stats`** WebSocket RPC serves per-personality spawn counts from a separate atomic-write stats file under `$OTTO_HOME/stats/` (not `config.json` — avoids spamming the config-changed broadcast). Spawns are counted at the `AgentManager.createAgent` choke point (`onPersonalitySpawn`), so composer, MCP `create_agent`, and schedule runs all increment. The editor surfaces "Used N times" per row.

The five `skills/*/SKILL.md` files teach role-aware discovery: committee prefers contrasting `advisor`/`judger`, advisor prefers `advisor`, handoff prefers `coder`, loop maps worker→`coder`/verifier→`judger`.

## Editor

Personalities are authored in the **Agent personalities** card (Host settings → Agents, `agent-personalities-section.tsx`), feature-gated on `features.agentPersonalities`. It reads/writes the roster via `useDaemonConfig`, so every save round-trips through `daemon-config-store.ts` and hot-reloads to all connected clients.

- **List rows** show name, `provider · model · roles`, a live `BlobLoader` in the row's spinner colors, and "Used N times" (from `agentPersonalities.get_stats`). Rows for out-of-commission personalities are grayed out with a reason via the shared `checkPersonalityAvailability` predicate — the same availability logic the pickers use.
- **Edit modal** (`PersonalityEditModal`): name field, provider → model → mode → effort pickers sourced from the live providers snapshot, personality-prompt textarea, respect-global-append toggle, role chips with an **All / None** toggle, two spinner **color inputs** (wheel + hex text) with a live `BlobLoader` preview, and a **TTS voice picker** (from `getSpeechSettingsOptions`, shown only when the host exposes voices).

The editor enforces the invariants that make a personality safe to reference:

- **Unique name, case-insensitive.** Names are load-bearing keys (spawn-by-name, running-agent selection), so a draft that collides with any other personality's name blocks save and shows an inline error. The check excludes the personality being edited.
- **Valid hex spinner colors.** Glow colors flow into daemon config, SVG gradients, and the `BlobLoader`; a hand-typed color must parse as hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) before save is enabled — the invalid input shows destructive styling and its swatch stays empty. The color wheel always emits valid values.
- **Double-submit lock.** Save awaits the config round-trip with the button locked, so a double-click can't mint a duplicate personality; the parent unmounts the modal on success and surfaces save errors itself.
- **Dirty-discard confirm.** Cancel/backdrop-close on a modified draft confirms before discarding (exact dirty check via a stringify of the JSON-safe draft against its initial value); a pristine draft closes immediately.
- **Concurrent-edit safety.** If the personality being edited vanishes from the roster mid-edit (deleted from another client), save re-appends it instead of silently dropping the mapped update.

## Starter team

A fresh host seeds a **starter team** so the editor opens with a working, role-complete roster instead of empty. Single source of truth: `DEFAULT_AGENT_PERSONALITIES` in `packages/protocol/src/default-personalities.ts`, imported by the daemon (first-run seeding) and the app (restore button). Six personalities, all Claude, covering all 8 roles: **Atlas** (orchestrator, chatter), **Sage** (advisor), **Vera** (judger), **Pixel** (artificer), **Dash** (writer, scheduler — the fast Haiku scribe for commit messages/summaries/names), **Sprocket** (chatter, coder).

Seeding is first-run-only and delete-safe: `bootstrap.ts` seeds the in-memory roster only when the persisted `agents.agentPersonalities` section is **absent** (distinct from an empty roster the user cleared), then `seedDefaultPersonalitiesIfAbsent` records it on disk once, writing only the personalities branch. Once the section exists on disk (even empty), seeding is a permanent no-op — **deleting the whole team sticks across restarts.** The editor shows "Add starter team" in the empty state and "Restore starter team (N missing)" as a footer, re-adding only builtins whose stable `personality_builtin_*` id is missing.

## Where the code lives

- **Shared (app + daemon):** `packages/protocol/src/messages.ts` (`AgentPersonalitySchema`, `PERSONALITY_ROLES`, the `agent.personality.set` schemas), `agent-personalities.ts` (role helpers, availability predicate), `default-personalities.ts`, `effort.ts`.
- **Daemon:** `packages/server/src/server/agent/agent-personalities.ts` (resolution + snapshot), `agent-manager.ts` (`setAgentPersonality` live switch), `session/agent-config/agent-config-session.ts` (the `agent.personality.set` RPC envelope), providers' optional `applyPersonality` (`providers/claude/agent.ts`, `providers/openai-compat-agent.ts`), `daemon-config-store.ts` (persistence/seeding), `tools/otto-tools.ts` (`create_agent`/`list_personalities`), `PersonalityStatsStore`.
- **App:** `packages/app/src/screens/settings/agent-personalities-section.tsx` (editor), `components/combined-model-selector.tsx` (picker section), `hooks/use-personality-selection.ts`, `provider-selection/personality-form.ts`, `composer/agent-controls/index.tsx` (`useRunningChatPersonality`, the running-agent live switch).
