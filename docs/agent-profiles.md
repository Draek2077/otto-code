# Agent Profiles

An **agent profile** (UI label: "Agent profiles", Host settings → Agents) is a named, reusable agent template stored per-host in the daemon config. It is the primary way a user picks "who does the work": instead of choosing a raw provider + model + effort + mode every time, they pick a profile once and it fills all of that in - on a local LM Studio model just as much as a frontier API. This is the provider-agnostic leveling-up pattern from [CLAUDE.md](../CLAUDE.md): a profile bound to a local model is as capable a Chatter or Judger as one bound to a hosted API.

This shipped as "Personalities" in 0.5.0, converged with Paseo's agent profiles onto one stored template in 0.8.13, and took the profile name inside and out in the same release. **"Personality" is retired as a term**: the type, the storage, the wire, the MCP surface and every user-facing string say profile now. A schedule's binding persists as the stable `id`, so renaming a profile no longer breaks it; see the identity invariant under [Data model](#data-model).

The wire carries both spellings for one compat window. `agent_state` emits
`agentProfileId`/`agentProfileName`/`agentProfileSpinner` alongside the
pre-rename `personality*` trio, `create_agent_request` accepts `agentProfile` or
`personality`, the schedule config writes both keys, and
`metadataGeneration.preferWriterProfiles` sits beside its old name. Readers take
the new name first. All of it is tagged `COMPAT(agentProfileFields)` for removal
after 2027-02-22, because a client older than the rename knows only the legacy
names and a schedule on disk has to survive a downgrade.

## What a profile binds

Each profile bundles a **brain** and an **identity**:

- **provider → model** pair,
- a **canonical effort level** (`off`…`max`), resolved to the model's nearest advertised option at spawn (see [glossary Effort](glossary.md), `packages/protocol/src/effort.ts`),
- a **default permission mode** (provider-scoped),
- a **profile prompt** (fills the per-agent `systemPrompt`),
- a **`respectGlobalAppendPrompt`** toggle (whether the daemon-wide `appendSystemPrompt` still stacks on top; `false` = the profile prompt stands alone),
- one or more **roles**,
- an **identity**: a name, two spinner colors, and an optional **TTS voice** (spoken identity).

## Data model

The roster is `agentProfiles` on `MutableDaemonConfig` (`packages/protocol/src/messages.ts`, alongside `MutableDaemonConfigSchema` / its patch variant, both `.passthrough()`). It persists through `daemon-config-store.ts`'s merge whitelist and hot-reloads over `status:daemon_config_changed`.

**One system, two names on purpose.** The stored template is `AgentProfile` in code, from the Paseo base this fork builds on; every string a human or a model reads calls it a **Profile**. Otto's older `agents.agentPersonalities` section is a tombstone: it is imported once, ids intact, then left on disk untouched. Its capability flag `features.agentPersonalities` stays advertised for old clients, tagged `COMPAT(agentPersonalities)`.

```
AgentProfile {                // "Agent profile" in every user-facing string
  id: string                    // stable, machine-generated; the ONLY thing references bind to
  name: string                  // human label, freely renamable, unique per host
  provider: string              // provider id (e.g. "codex", "openai-compat")
  model?: string                // provider-scoped model id; absent means the provider's default
  effortLevel?: EffortLevel     // canonical: off|minimal|low|medium|high|xhigh|max
  thinkingOptionId?: string     // a provider's own option id, when it maps to no canonical rung
  modeId?: string               // default permission mode (provider-scoped)
  featureValues?: Record<string, unknown>  // provider feature toggles this template pins
  notes?: string                // free text, written for orchestrating agents
  personalityPrompt?: string    // → per-agent systemPrompt
  respectGlobalAppendPrompt: boolean   // default true
  roles: ProfileRole[]      // one or more
  icon?: string                 // key into a fixed icon registry
  color?: string                // identity-palette colour name
  spinner: { glowA: string; glowB: string }         // two hex colors for BlobLoader
  voice?: { provider: string; model: string; name: string }  // TTS voice; soft binding
  voiceCues?: { join?: string[]; thinking?: string[]; waiting?: string[]; done?: string[] }  // Visualizer spoken cues
  memoryEnabled?: boolean       // accrues lessons across sessions; ABSENT MEANS ON (see Memory)
}
```

`personalityPrompt` is the prose that shapes how the agent behaves; it can be hand-written or authored for you (see [Generating a profile prompt](#generating-a-profile-prompt)).

`voiceCues` are the pre-generated (and hand-editable) short lines an agent **speaks** in the profile's voice at four moments - it joins, first starts thinking, waits on still-running sub-agents, completes a turn. Stored on the profile so they're deterministic and tunable (playback reads them directly, no runtime generation). Authored in the editor's Voice tab (Generate button + auto-generate on save when empty); see [Voice cues](#voice-cues) below.

This is the logical shape; on the wire everything past `provider` is optional and plain (`AgentProfileSchema`, `messages.ts` - no enums) for forward compat, and the daemon validates values against its own catalog when applying a patch.

Two invariants:

- **Identity is the `id`, never the `name`.** Renaming a profile must not break any schedule, remembered picker selection, or in-flight agent. Everything **stores** the `id`. Surfaces a human or a model types into (the `agentProfile` field on `create_chat` and the schedule tools) accept either, through one shared lookup - `findProfileByRef` (`packages/protocol/src/agent-profiles.ts`), which matches id first, then exact name, then case-insensitively - and what they persist is always the id.
- **Effort is stored canonical, resolved at spawn.** Store the `EffortLevel`, never a raw `thinkingOptionId` (option ids differ per model). Resolve against the bound model at spawn with `resolveEffortOption` (`packages/protocol/src/effort.ts`; `packages/server/src/server/agent/effort-levels.ts` re-exports).

## Roles

A profile carries one or more roles. Roles gate where a profile **shows up**; they are not a permission gate. A new profile defaults to **all roles**; the editor has an All / None toggle.

| Role             | Consumed by                                                                                                    | App picker surface today                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Chatter**      | Interactive agent chats                                                                                        | Composer agent-controls picker                     |
| **Artificer**    | Creating & managing artifacts                                                                                  | Artifact create sheet                              |
| **Scheduler**    | Creating & managing schedules                                                                                  | Schedule form sheet                                |
| **Researcher**   | Read-only surveying - maps the code or domain and reports findings                                             | None yet - via skills / orchestration              |
| **Planner**      | Turns a goal into a typed, sequenced phase plan for others to execute                                          | None yet - via skills / orchestration              |
| **Judger**       | Judging / review passes                                                                                        | None yet - via committee / review skills           |
| **Advisor**      | Planning / second opinion; **read-only / advisory**                                                            | None yet - via advisor / committee skills          |
| **Coder**        | Spawned as a coding sub-agent (incl. text-editor AI refactor)                                                  | None yet - via skills / MCP                        |
| **Designer**     | Styling and layout, plus the human-skill text (copy, naming)                                                   | None yet - via skills / orchestration              |
| **Writer**       | Fast small-text generation - commit messages, PR text, branch/workspace names (mini-tasks)                     | None (daemon-internal, see below)                  |
| **Orchestrator** | Drives multi-agent workflows. **Semantic label only** - enumerating & spawning profiles is open to every agent | None yet - via committee / panels / handoff / loop |

The role catalog lives in `PROFILE_ROLES` (`packages/protocol/src/personality-schemas.ts`) and the shared predicates, tier metadata, and roster lookup in `packages/protocol/src/agent-profiles.ts` (used by both app pickers and the daemon). The table is in catalog order.

### Role tiers: coordinators vs focused workers

Roles fall into two behavioral **tiers** (`PROFILE_ROLE_INFO` in `agent-profiles.ts`):

- **Coordinators** - **Chatter, Artificer, Scheduler, Advisor, Orchestrator.** They converse, plan, and may delegate when the task benefits from a dedicated worker or multi-agent coordination.
- **Focused workers** - **Writer, Coder, Judger.** They lift a single thing someone is waiting on and should stay on task, not fan out into sub-agents.

A profile that carries **any** coordinator role is a coordinator (`profileCanLaunch` - a `chatter + coder` both codes and delegates); one whose roles are entirely focused (or roleless) is a focused worker.

**This is guidance, not a gate.** Every agent keeps the same tools - `list_agent_profiles` and profile-named spawns are open to all (that's the "see and understand each other" property). The tier only drives two in-context nudges:

- **A chat-start role directive** (`composeRoleFocusDirective`) folded into the profile's system prompt: the orchestrator selects direct work, `create_chat`, `suggest_task`, or `start_orchestration` by the capability the task actually needs; other coordinators may delegate only when that helps; focused profiles are told "someone is waiting on this - stay on it, don't create child chats unless essential."
- **`list_agent_profiles` decision-aid fields** - every entry carries `tier`, `canLaunch`, and a `guidance` "why you'd choose me" blurb (joined from its roles' taglines), so a deciding agent self-selects the right teammate from the list alone.

**Writer and Coder replaced the old single `Worker` role.** Worker split into the fast small-text tier (`writer`) and the coding sub-agent tier (`coder`). A profile persisted with the retired `worker` tag resolves to `coder` via `LEGACY_ROLE_ALIASES` in `agent-profiles.ts` - normalization maps it before filtering, so no profile silently loses its role. Roles still ride the wire as plain strings, so old peers keep parsing.

### Writer routing (mini-tasks prefer a profile first)

Daemon-internal mini-tasks - commit messages, PR title/body, and branch/workspace name generation - resolve their model through `resolveStructuredGenerationProviders` (`packages/server/src/server/agent/structured-generation-providers.ts`). When a caller passes `role: "writer"`, every **available** Writer profile (checked against the live provider snapshot with the same `checkProfileAvailability` predicate the pickers use) is resolved to a concrete provider/model/effort and **prepended ahead of the legacy chain** (explicit `metadataGeneration.providers` config → built-in substring preference list → current selection → hardcoded string). So a user's Writer profile is the primary worker for these tasks; the legacy substring list is the fallback that only runs when no Writer is available or all of them fail. The profile's canonical effort resolves to the model's nearest advertised thinking option here, exactly as at spawn. The two callers that pass `role: "writer"` are `git-metadata-generator.ts` (commit + PR) and `worktree-branch-name-generator.ts` (titles + branches); the roster reaches the resolver through `StructuredGenerationDaemonConfig.agentPersonalities`.

## Availability ("out of commission")

A profile is **available on a given host + workspace (cwd)** only if every bound setting resolves against the live providers snapshot there: the provider is present/enabled/authenticated, the bound model exists in that provider's snapshot, and the bound `modeId` exists among that provider's modes. Availability is evaluated against `provider-snapshot-manager.ts` / `use-providers-snapshot.ts`.

If any check fails the profile is **out of commission**:

- **In pickers:** grayed out with a reason ("Blaze - LM Studio not connected"), not selectable.
- **In automation (schedules, spawn-by-name):** a **hard-fail with a visible, named error.** No fallback to another model or provider - this follows the repo's no-fallback-paths rule. A schedule pointed at an out-of-commission profile fails its run loudly rather than silently substituting.

The voice is the one exception: it is a **soft binding** and never gates availability - an unresolvable voice degrades to the host default at playback.

A profile that omits `modeId` inherits the provider's default mode - but resolution validates that fallback against the provider's live modes catalog before using it (`resolveFallbackModeId`, `agent-profiles.ts`). A provider's advertised `defaultModeId` can go stale relative to its modes; availability only checks the profile's _own_ `modeId`, so an unvalidated fallback would pass resolution and then throw inside `setMode` at apply time. When the fallback is itself absent from the catalog, resolution drops it and the provider picks its own default.

## Resolution & lifecycle

**Spawn snapshots the profile onto the agent.** At spawn the profile resolves to a concrete blob - `ResolvedProfileSnapshot` (`packages/server/src/server/agent/agent-profiles.ts`) - stored as `AgentSessionConfig.profileSnapshot` and persisted via `SERIALIZABLE_CONFIG_SCHEMA`. From then on the agent is frozen to its snapshot.

- **Editing a profile never mutates an in-flight or observe-only agent.** Running streams and read-only observed agents keep the snapshot they were born with - there is no automatic re-resolution, next-turn or otherwise. The only way an existing agent picks up roster edits is an explicit live switch (below), which re-resolves the profile fresh; re-selecting the same profile via the switcher is how you pull edits into a running chat.
- **New jobs re-resolve.** Any fresh spawn picks up the current (edited) settings.

**Override semantics.** Selecting a profile in a picker fills the underlying provider/model/effort/mode fields; the user may hand-edit any of them (an explicit per-field override) and **the agent keeps the profile identity** (name, spinner colors, prompt) with the overridden brain layered on. Only an explicit "clear profile" detaches back to a plain provider/model selection. In tooling, the template applies verbatim and a caller may override individual fields **only when explicitly requested** - no heuristic substitution.

## What the model picker shows (the precedence ladder)

Every apply-now picker - New Chat, New Workspace, New Artifact, New Schedule - resolves the same five tiers, in this order, and the first one that produces a value wins outright. There is no per-surface variant: a picker whose contents depend on which screen opened it is unpredictable by construction.

| Tier  | Source                                                     | Applies                            |
| ----- | ---------------------------------------------------------- | ---------------------------------- |
| **1** | The **active team's** holder of the surface's role         | always, no exceptions              |
| **2** | A **profile** carrying the role                            | always, no exceptions              |
| **3** | The device's **last-used model** for the provider          | only if 1 and 2 are empty          |
| **4** | The provider's **default model** (`isDefault`, else first) | only if 3 is empty                 |
| **5** | Nothing                                                    | only if the provider has no models |

Within tier 2 the device's `lastPersonalityByRole` decides **which** profile - remembered first if it still carries the role and is available, otherwise the first available holder. Memory picks the profile; it never demotes the tier. Seeing a bare model name in a picker therefore means exactly one thing: **no team and no profile carries that role.**

Tiers 1–2 live in `useFormRolePersonality`'s default effect (`packages/app/src/provider-selection/role-model-personality.ts`, `autoSelectDefault: "always"`). Tiers 3–5 live in `resolveModelField` (`packages/app/src/provider-selection/resolve-agent-form.ts`). The one surface that opts out is a picker **editing a stored record** (schedule edit, artifact edit): the record's own binding is a tier above all of these, and re-deriving would overwrite it.

### Which surfaces remember

Preferences seed the create surfaces and nothing else.

- **New Chat / New Workspace / New Artifact / New Schedule** - an explicit model, mode, or effort pick writes the device preference; an explicit profile pick writes `lastPersonalityByRole`.
- **Existing chats, and any chat past its first message** - **no writes at all.** Switching a started agent's model retargets that agent and leaves no trace: no model preference, no effort preference, no remembered profile. A mid-chat switch feeding back into the create surfaces is what made New Chat open on a model nobody had chosen for it.

Two writes are suppressed even on create surfaces, both for the same reason - a value that arrived from a higher tier must never be written into a lower one, or the tier it outranks gets overwritten with the winner and reads back next open as the user's own choice:

- **Profile and team applies don't persist.** They go through `applyPersonalityValues` (`use-agent-form-state.ts`), which sets the form without touching preferences. `setModelFromUser` / `setProviderAndModelFromUser` - real user picks - still do.
- **An auto-resolved tier-2 profile doesn't persist either** (`selectPersonality(id, { persist: false })`). `lastPersonalityByRole` means "what the user chose"; an auto-pick writing itself back would freeze "first available" in place the moment the roster order changed.

Submitting under a profile is covered by the same rule: `persistFormPreferences` and the schedule form's `persistPreferences` both no-op when a profile or team slot is bound.

**Overrides are session-only.** Picking a model by hand while a profile is bound clears the profile for that draft (and, on a running agent, after one confirm) but writes nothing - reopen the surface and tier 1/2 reassert.

### Two profile lists, two press semantics

Form pickers render the roster twice, and the rows behave differently on purpose (`PersonalityRow`, `combined-model-selector.tsx`):

- The up-front **Profiles** section is this surface's role-filtered (and team-scoped) shortlist, and the row IS the current binding - so pressing the selected row **clears** the profile. That toggle is the only explicit "clear" affordance the running-agent picker has.
- The **active team / "All profiles"** drill-down is a roster directory over the whole roster, reachable regardless of the surface's role. Its rows are **select-only**: pressing one always binds that profile, including the one already bound. Toggling off here meant a press on a name silently detached the profile and left the raw model as the agent's identity - the opposite of what picking a name means. Clear from the shortlist, or by picking a raw model.

## Live switch (running agents)

A RUNNING chat agent can be switched to another profile - or cleared - without losing its conversation.

**RPC + gate.** `agent.personality.set.request` / `.response` (`packages/protocol/src/messages.ts`): `agentId` + nullable `personalityId` (null = clear). Gated by `server_info.features.setAgentPersonality`, tagged `COMPAT(setAgentPersonality)` - an old daemon simply doesn't advertise the flag and the app hides the switcher entirely; there is no fallback path.

**Strict resolution.** The session shell (`Session.resolvePersonalitySnapshotForAgent`, `session.ts`) re-resolves the roster id against the agent's cwd before applying. Unlike spawn's soft-skip (`applyPersonalityIdentityToConfig` logs and spawns without identity), the live switch **rejects the RPC** when the profile is unknown or out of commission, surfacing the unavailability reason. It warms only the profile's own provider snapshot so a cold workspace doesn't fan out network probes to every provider.

**Daemon semantics** (`AgentManager.setAgentPersonality`, `agent-manager.ts`). The switch applies the full profile atomically in one request:

- **Brain** (model/mode/effort) rides the existing live-session setters (`setModel`/`setMode`/`setThinkingOption`) - applied only when _binding_; **clearing keeps the brain** (model, mode, and effort stay as they are).
- **Prompt** goes through the provider session's optional `applyPersonality` (`AgentSession`, `agent-sdk-types.ts`). Providers that don't implement it (they can't change a system prompt mid-conversation) **reject cleanly** before anything is applied. A profile bound to a different provider than the agent's also rejects.
- **Identity** (name/spinner) follows automatically: the resolved snapshot persists as `config.profileSnapshot`, and `agent_state` projects `personalityId`/`personalityName`/`personalitySpinner` from it.
- **Serialization:** config mutations on one agent (profile set, model/mode/effort/feature changes) run through a per-agent promise-chain lock in `AgentManager`, so two racing RPCs can't interleave into a mixed half-and-half state.
- **Prompt ownership** mirrors spawn: the profile prompt only owns `config.systemPrompt` when the caller set none at spawn (or it equals the outgoing profile's prompt) - a caller-authored prompt survives switches. `respectGlobalAppendPrompt === false` drops the daemon-global append prompt, same rule as at spawn.

**Provider differences.** Claude bakes the system prompt into the query options, so `applyPersonality` flags a **lazy query restart**: the change lands on the next turn, resuming the same session id; if a turn is active the RPC returns an "applies next turn" provider notice. The openai-compat provider owns its conversation (`messages[0]` is the system prompt, re-sent every request), so it rebuilds the prompt in place - no restart needed.

**App flow** (`useRunningChatPersonality`, `packages/app/src/composer/agent-controls/index.tsx`). On a running chat agent, the model picker's provider-family menu pins roster profiles that have the **Chatter** role and match the agent's provider family, filtered by the picker's search box on name. Picking one shows a warning dialog (switches prompt, model, mode, effort; applies next turn) with a "Don't show this again" checkbox persisted as a device-local form preference. While the RPC is in flight the model trigger shows a spinner and the composer locks send/dictation/voice-mode (typing and attachments stay enabled), with a 30-second timeout that re-enables the controls if the daemon doesn't answer. Picking a **raw model** while a profile is bound shows one combined confirm and then clears the profile and applies the model as a single locked flow - the profile detaches and its prompt reverts per the ownership rule. Selection keys on `agent_state.personalityId` (stable across renames), with a `personalityName` match as the fallback against daemons that predate the field; there is no client-side selection state to drift. When the bound profile can't be found in the selectable roster (deleted, renamed on an old daemon, Chatter role removed, or the daemon predates the live switch), the picker synthesizes a display-only entry from `agent_state` so the trigger keeps the truthful name + spinner.

The RPC shares the per-agent config envelope in `AgentConfigSession` (`packages/server/src/server/session/agent-config/agent-config-session.ts`): success returns any provider notice, failure emits an `activity_log` error frame plus the rejected response.

## Identity (spinner + voice)

- **Spinner:** the profile's two colors ride onto the agent's live thinking indicator (`BlobLoader`, `packages/app/src/components/blob-loader.tsx`) via the additive `AgentSnapshotPayload.personalitySpinner` (absent ⇒ theme default). This is the first per-agent color path for the live spinner. The composer/tab trigger shows the provider glyph filled with the two colors as a static 45° gradient (`PersonalityProviderIcon`); the left sidebar stays theme-generic by design.
- **Voice:** a per-utterance `SpeechVoiceOverride` threads through `synthesizeSpeech(text, voice?)` → `TTSManager` → the provider. Sherpa resolves the voice name to a local speaker id (soft binding); OpenAI honors a valid OpenAI voice name. A profile agent speaks in its own voice in realtime voice mode. See [voice architecture](../public-docs/voice.md).

## Generating a profile prompt

The Profile tab has its own **Generate with AI** button, which writes the `personalityPrompt` from the only three things the editor knows before one exists: the **name**, the **roles** it will be spawned for, and its two **spinner colors**. Same shape as cue generation: persona passed inline so an unsaved draft can generate, one structured pass, editor-time only. RPC: `agentPersonalities.generate_profile` (`session.ts`, generator in `packages/server/src/server/agent/profile-prompt-generator.ts`), gated by the `personalityProfile` capability.

Three decisions worth keeping:

- **Role fit is the product, not the flavor.** A profile prompt rides in every request that agent makes ([token economy](token-economy.md)), so it has to earn its tokens by making the agent better at its job. The prompt carries, per role, both the role's own "why you'd choose me" guidance (`PROFILE_ROLE_INFO`) and a `ROLE_VIRTUES` line describing what a _great_ holder of that role is like, plus the explicit disqualifiers: no researcher who rushes or skips references, no judger who avoids conflict to be nice, no coder who claims done without checking. Traits are also required to say how the agent hands work off and disagrees, because these are teammates.
- **The model returns parts; the daemon assembles the prose.** The structured output is a character sheet (pronouns, archetype, traits, teamwork, speech, quirk, motto), and `assemblePersonalityProfile` renders it into a fixed compact second-person shape. A model asked for the whole prompt writes a page of backstory; a model asked for parts writes content and lets us own the size.
- **Colors arrive as words, never hex.** `describeGlowColor` turns each glow into a phrase ("vivid azure"), and the prompt reads the palette as temperature and energy while forbidding any color talk in the profile itself. Handing a model raw hex mostly gets the hex quoted back at you.

Overwriting a non-empty prompt asks first: a generated profile is never worth losing something hand-written.

## Voice cues

An agent can **speak** a short line in its own profile voice at four lifecycle moments - it **joins** (**starting**: "On it"), it **first starts thinking** ("Working on it"), it finishes its own turn while its observed sub-agents are still running (**waiting**: "Still hearing back"), and it **completes** a turn ("Done"). Each moment's lines must read as unmistakably that moment - a generic line like "All set" that fits starting/thinking/done equally is the anti-pattern the generator and editor steer away from. On by default; the toggle and its volume are **Settings → \<host\> → Agents → "Voice cues"** (device-local `agentVoiceCues` + `agentVoiceCuesVolume`).

**Quick mute in the workspace header.** `voice/workspace-voice-cues-button.tsx` sits in the title cluster immediately left of the Visualizer button (speech glyph, `RecordVoiceOver` / `VoiceOverOff`), styled and sized exactly like it - accent while unmuted, `lg` glyph in compact, `md` on desktop.

**Mute is not disable.** The button writes `agentVoiceCuesMuted`, never `agentVoiceCues` - the same split the Visualizer has between its feature switch and its in-page speaker button. `agentVoiceCues` is "do I want this feature at all" and lives in settings; the mute is "not right now" and lives one click from where you work. Consequences worth stating, because collapsing the two reads fine until you try it: muting leaves the button on screen showing its muted glyph, while **disabling cues in settings removes the button entirely** - a mute for something switched off is a control over nothing, and a button that turned itself invisible would be a trap. Playback needs both (`agentVoiceCues && !agentVoiceCuesMuted`).

`useVoiceCuesAvailable()` owns that gate (host capabilities **and** the enable flag). The button joins the compact header's width budget as `voiceCues` - **first to drop** (see `compact-header-actions.ts`), because it is the only button in that row whose loss costs no capability: cues keep playing, and the switch is still in settings.

**This is a notification channel, not a Visualizer feature.** Cues were born in the Visualizer and were briefly mounted by its panel on the same `ready && isVisible` gate as the event adapter, so they could only speak for the one workspace whose Visualizer tab happened to be frontmost - a notification channel that only works while you are looking at it is not one. Playback now runs app-globally with **no visibility, focus, or Visualizer condition at all**, and with none of the visual performance: the render bundle isn't loaded, no canvas exists, only the audio fires. Disabling the Visualizer does **not** silence cues, and neither does muting it. What remains: the `agentVoiceCues` setting, the cue channel's own volume, and the host capabilities.

Scope decisions (locked): **only the main/root agent speaks** (a fan-out of subagents never becomes a chorus), **only profile-backed agents** (an agent with no bound profile is silent), and **only on a host that advertises both `visualizerVoiceCues` and `ttsPreview`** capabilities. The first flag keeps its historical name because it is a wire key - renaming a `server_info.features` field would break the contract with older daemons.

How it's wired - entirely host-side, **no vendor patch** (playback can't live in the CSP-locked webview):

- **Lines are stored on the profile, not generated at runtime.** Each profile carries an optional `voiceCues { join?, thinking?, waiting?, done? }` (`AgentProfileSchema`) - a few short editable variations per moment. They're authored and hand-tuned in the **profile editor's Voice tab**: a "Generate with AI" button fills the fields via the daemon's Writer mini-task chain, and **on save, if the cue fields are still empty, they're auto-generated** so every profile ends up with a set. Generation lives in `packages/server/src/server/agent/voice-cue-generator.ts` (Writer chain, flavored by the persona's `name` + `prompt` + `roles` - a "researcher" and a "coder" get different quips) behind the `visualizer.voiceCues.generate` RPC (`session.ts` `dispatchVisualizerMessage`) - the persona is passed **inline** (name + prompt), not by stored id, so an unsaved draft can generate too. **One pass authors all four moments.** The editor sends a single request with no `moment` field. It used to fan out one request per moment, on the theory that a focused prompt keeps the moments distinct; what it actually bought was four cold-start generations and four independent readings of the persona, so the groups drifted apart in character while still repeating each other's lines. The combined prompt hands the model the whole cast sheet at once (the persona, its roles and what each role is _for_ via `PROFILE_ROLE_INFO` guidance rather than just the role word, and all four moments with their meanings and banned stock lines), then makes it commit to a `voice` sentence **first**: an in-schema scratchpad, read for its effect on the lines and then discarded. Distinctness comes from the model seeing the four groups side by side, plus a server-side pass that drops a line reused at a later moment (never emptying a group). The per-moment `moment` field stays on the wire for older clients that still send it. Closing the editor mid-generation discards the draft, so lines that land after close are dropped unsaved. The `visualizerVoiceCues` capability marks that the daemon can author lines (Writer chain, always available); playback separately needs `ttsPreview`.
- **Runtime reads stored cues, with guaranteed stock fallbacks.** `use-agent-voice-cues.ts` looks up the agent's profile in the roster and picks a random line from `personality.voiceCues` - **no runtime generation, no cache**. If a profile has no cues, or a lifecycle group is empty, it speaks the corresponding default: **Starting!** (join), **Thinking...** (thinking), **Waiting...** (waiting), or **Complete!** (done). This keeps every profile-backed agent audible without adding first-cue latency or per-restart generation.
- **Audio** reuses the existing `speech.tts.preview` path: the client synthesizes the picked line with the profile's TTS `voice` via `client.previewTtsVoice` and plays it through the shared `voice-context` audio engine - exactly what the voice-preview button does.
- **Orchestration** is `packages/app/src/voice/use-agent-voice-cues.ts`, mounted **app-globally** by `agent-voice-cues-host.tsx` - a headless component in `_layout.tsx`'s ProvidersWrapper (inside `VoiceProvider` so the shared audio engine resolves, above the router so it never unmounts on a route/tab change), one hook instance per connected host with `workspaceId: null` = every workspace. It subscribes to the session store, watches root-agent status transitions (`join` = new agent, `thinking` = first `running`, `done` = `running`→`idle`), and - critically - **seeds already-present agents silently** so attaching to an in-flight session never re-announces history. A module-level dedupe coalesces the same cue across hook instances, and playback never talks over an in-flight cue (`engine.isPlaying()`).
- **`waiting` is a DEFERRAL of `done`, not a replacement.** There is no "waiting" agent status to watch - the condition is composed: the parent's turn finalized (`running`→`idle`) **and** at least one **observed** sub-agent in its track is still running (`hasRunningObservedSubagent` in `subagents/select.ts`, the same track membership the subagents rail renders, so an _attended_ child - its own chat, its own cues - never holds the parent). So the `running`→`idle` edge only records a **debt** (`doneDeferred`); each later store tick either speaks `waiting` once (`waitingAnnounced`, because observed rows land over several ticks) and holds, or, once the fan-out has drained, pays the debt by speaking `done`. A new turn (`running` again) cancels a pending debt - the stale `done` never fires. A profile authored before this moment existed uses the default **Waiting...** cue until its own cues are generated.

**Volume is its own channel.** Cues scale to `agentVoiceCuesVolume`, **not** the Visualizer's sound volume - they were briefly shared, which meant muting a graph's ambience silently muted your notifications, and one level had to serve two unrelated purposes. The voice engine has no per-play volume, so the level is applied by scaling the PCM samples by `agentVoiceCuesVolume/100` (linear amplitude, the same shape the vendor page's gain node uses on its own effects), read live via a ref so the slider tracks without tearing down the subscription. Only the PCM default is scaled; a non-PCM TTS format (e.g. mp3) plays unscaled. 0% is silence; the toggle is the real off-switch.

**Throttling** is three layers deep, because app-wide firing makes "every agent in every workspace cues at once" a real failure mode rather than a theoretical one: a per-(agent, moment) dedupe window (`CUE_DEDUPE_MS`), an **app-wide rate limit** of one cue start per `CUE_GLOBAL_MIN_INTERVAL_MS` (claimed _after_ the line lookup, so a silent agent never burns the slot for a speaking one), and the pre-existing `engine.isPlaying()` guard. Everything over the limit is **dropped, never queued** - a stale "Done" arriving 30 seconds late is worse than silence.

Caveat: the very first cue on **web** may be silent until the user has interacted with the page once (browser autoplay unlock - cues fire without a fresh gesture).

## Memory (accrued lessons)

A profile **accrues lessons across sessions** and carries them into every later spawn. Naming an agent and giving it a role is a claim about continuity, and continuity without memory is cosmetic - every spawn used to start from zero.

Underneath these are just stored memories: a flat list of text entries keyed to the profile id. No graph, no embeddings, no per-profile storage tier. The capability flag is `server_info.features.personalityMemory`, tagged `COMPAT(personalityMemory)`; without it the client hides the whole feature, since storage is daemon-side by definition and there is nothing a client-side fallback could read.

### Storage

`$OTTO_HOME/personality-memory/<personalityId>.json` - one file per profile, atomic writes, no migrations (see [data-model.md](data-model.md)). Entries carry `text`, `scope` (`project` | `global`), an optional `projectRoot`, timestamps, a `source` (`agent` | `user` | `review` | `transfer`), a `reinforcedCount`, and an optional `transferredFrom`.

**One file per profile, not one file per fact.** The harness's own one-fact-per-file layout exists because an _agent_ maintains that index by hand; here the daemon maintains it, so splitting buys nothing and costs the atomicity that makes transfer-on-delete a single write. Every mutation goes through a **per-profile serialized read-modify-write queue** - two agents spawned from one profile can record concurrently, and a lost increment there is a lost lesson. Caps: 200 entries per profile, 1,200 chars per lesson.

**Keyed to the profile id, never the agent.** The agent is ephemeral; the profile is the continuity. An agent whose profile has since been deleted from the roster still keeps that identity's lessons - the spawn snapshot outlives the roster entry, and so does its memory.

**Scope is resolved, not configured.** A lesson defaults to the current project and an agent can mark one `everywhere`; injection is `global ∪ thisProject`. The project root is the **git repo root**, resolved daemon-side, so a worktree and its main checkout share one project's lessons. A client must never compute this itself - it would disagree with the daemon the moment a worktree is involved, and then the brief shown would not be the brief injected.

**Every project-scoped WRITE carries a project too, or it is refused.** The filter compares roots (`selectEntriesForProject`), so an entry with `scope: "project"` and no `projectRoot` matches no project and is injected **nowhere** - while the Memory tab still lists it. That is the worst possible failure: storage and injection disagreeing, silently. So `personality.memory.update.request` takes the same `workspaceId` the list request does, `Session.resolveMemoryRequestRoot` resolves both sides through one function, and a project-scoped write with no resolvable root is **rejected** rather than stored. `revise_lesson` passes the calling agent's `cwd` for the same reason - a lesson moved from `everywhere` to `project` needs a root to move _to_.

On revise, the **existing** binding wins over the caller's: the Memory tab lists every project's lessons, so editing one while standing in another repo must not re-home it. The caller's root only fills a gap, which is exactly what a global→project move needs.

**"Nothing is injected" and "nothing is stored" are different facts.** The tab says which. An empty brief above a populated list means the lessons are scoped elsewhere, and each row says so - `Another project` for a different root, `No project - never sent` for a legacy unattached entry (editing one and saving re-binds it here). Reporting only "nothing is added" while rows sit below it reads as a bug rather than as scoping, which is how this defect was found.

### The three tools

Registered on the daemon's existing MCP catalog, so **every provider gets them at once** - Claude, Codex, OpenCode, and an openai-compatible local model alike. They fall in the existing `agents` tool group (`ottoToolGroupForName` routes unprefixed names there), so the per-group allowlist can switch them off; a **new** group value was rejected because `OTTO_TOOL_GROUPS` is a wire enum an older peer could not parse. All three resolve the calling agent's profile from `callerAgentId` and fail with a named error when there is none - memory belongs to a profile, not to a single chat.

| Tool              | Shape                                           | Ergonomics                                                      |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `remember_lesson` | `{ lesson, scope?: "project" \| "everywhere" }` | Fire-and-forget. Returns `added` or `reinforced` - never an id. |
| `review_lessons`  | `{}`                                            | Every lesson with a short handle, plus the review protocol.     |
| `revise_lesson`   | `{ handle, lesson?, scope?, forget? }`          | One reviewed outcome. Only reachable through `review_lessons`.  |

**Recording is fire-and-forget, and that is the load-bearing design decision.** The agent states what it learned - no ids to track, no file to choose, no index to maintain. If recording were any harder than that, agents would not do it. Which means **dedup is the daemon's job, not a discipline in the prompt**: `lesson-dedup.ts` scores lexical token overlap (Jaccard over significant tokens) and a near-duplicate **reinforces** the existing entry instead of adding a row. Deliberately lexical - no model, no network, microseconds, and trivial to reason about when it gets one wrong. The threshold sits high (0.75) because the failure modes are asymmetric: a missed duplicate costs one redundant line that `review_lessons` will consolidate, while a false merge silently destroys a distinct lesson. At 0.7, two six-word lessons differing by a single discriminating token scored 0.71 and merged.

Only **same-scope** entries are dedup candidates. "Always true here" and "always true everywhere" are different claims even in identical words; merging them would silently widen or narrow a lesson's reach.

**`review_lessons` is the deliberate counterpart, with the opposite ergonomics.** Its description carries the protocol, because the protocol _is_ the feature: read the lessons back, look for ones that are wrong, too vague to act on, or overlapping, **ask the user about them rather than guessing**, then call `revise_lesson` per outcome. A model that rewrites without asking has laundered its own assumptions into permanent storage. This is also why there is no scheduled consolidation pass: an unattended rewrite of behavioural rules is the one thing worth never automating.

### Injection

**Where:** `AgentManager.prepareSessionConfig` - the single choke point every spawn, resume and refresh path already funnels through (composer, MCP `create_chat`, schedule runs, orchestration runs, reattach). One site, above every provider adapter, no per-caller threading. The live profile switch composes it through the same helper (`withPersonalityMemory`), so a profile behaves identically however you attached it.

**Runtime-only, never stored.** The brief is appended to the **launch** config's system prompt and deliberately not to `storedConfig`, mirroring how `daemonAppendSystemPrompt` is re-derived on resume. Two consequences, both wanted:

1. Memory is **re-read on every resume** - a lesson recorded yesterday is present today without rewriting any agent record.
2. The live-switch prompt-ownership check (`config.systemPrompt === outgoingComposedPrompt`) keeps comparing memory-free prompts, so it cannot start failing the moment a profile learns something.

**Independent of `respectGlobalAppendPrompt`.** That toggle governs the _daemon-global_ append prompt; these lessons are the profile's own, so a profile that stands alone still gets them.

**The brief is composed by one pure function** (`memory-brief.ts`), and that is what makes the feature inspectable: the RPC serving the UI and the spawn path injecting the prompt call it with the same inputs and get the same string, so what you are shown cannot drift from what is sent. Ordering is the budget policy - most-reinforced first (a lesson relearned three times has earned its place over a one-off), then most-recently-updated, then id for stability, because a prompt that reshuffles between spawns defeats provider prompt caching for nothing. The cap is `MEMORY_BRIEF_TOKEN_BUDGET` (1,500 tokens ≈ 0.75% of a 200K window, ≈ 4.7% of a 32K local model's - the constituency that actually feels it), and when entries are dropped **the brief says so and names `review_lessons`**: a silent truncation would make the injected set differ from the shown set.

The brief's preamble does three things a bare list cannot - it tells the model these are its **own** prior conclusions rather than a user instruction to obey blindly, it says what to do when this session contradicts one, and it marks each numbered item as recorded data that cannot direct action or override instructions. The first two are the difference between memory and dogma; the third is the trust cue for the containment below. All are asserted in tests rather than left to prose review.

**Lesson text is contained, never trusted.** Entries are model-authored: `remember_lesson` may relay whatever a summarized web page told the model to record. Left raw, a multi-line entry carrying its own `## heading` would escape its numbered list item and read as top-level system-prompt structure in every later session, a prompt injection that persists across the conversation that introduced it. The defense is structural containment, not content classification, and it is layered: the store collapses newlines and control characters to spaces at write time (`normalizeLesson`), and the composer flattens again at render time (`flattenLessonText`), which also covers entries stored before the normalization existed. Markdown headings and code fences bind only at the start of a line; a one-line entry gives them nowhere to bind. A delimiter wrapper around the whole brief was considered and rejected on token-economy grounds: the preamble's one-sentence "recorded data, not an instruction" cue carries the trust marking at a fraction of the recurring cost.

**`memoryEnabled` on `AgentPersonality`: absent means ON.** A profile with no lessons injects nothing and costs nothing, so an off-by-default switch would only mean the feature never starts working for anyone who did not go looking for it. The switch exists to stop a profile accruing, not to start it - and the editor writes the field **only when false**, so the default state stays absent on the wire.

### Where you see and manage it: Context Management

Context Management owns "everything sent before you type", and memory is part of that, so the surface lives there rather than in the profile editor - per-profile editing scattered into a settings dialog would need list and diff tooling that surface does not have, and would split memory across two places.

- **A "Viewing context for" selector** in the summary, beside the window presets (both answer the same question, so they share a visual idiom). Picking a profile re-requests the report with `personalityId`, so the category bars and the working-room figure include that profile's memory. **"Everyone"** is a real selectable answer, not a null state.
- **A Memory sidebar tab**, beside Context and Worth fixing, badged with the lesson count and **never toned** - lessons are not a problem to fix, and amber would read as "this profile learned something wrong". Absent entirely on a host without the capability.
- The tab shows **the injected brief verbatim** with its recurring cost, then the stored rows: editable in place, deletable, with an explicit scope toggle and an add-by-hand affordance.

Two shape decisions worth keeping:

- **Memory is not a node in the graph tree.** Tree rows open in the file pane and a lesson is a stored row, not a file; a row that opened a nonexistent path would be a worse lie than not being there.
- **No new `ContextCategory` member.** That schema is a `z.enum` travelling daemon→client, so a new value would make a new daemon's report unparseable by an older client. Memory weight folds into `otto_injected`, which is literally what it is: prompt text Otto composes and injects. The report also carries additive `personalityId` / `personalityMemoryTokens`.
- **Editing does not reuse Refine**, deliberately. Refine works on a _set of files_ and reviews a diff hunk by hunk - complexity that earns itself on a long document and is pure overhead on a two-sentence lesson. The model-assisted path for improving a lesson is `review_lessons`, which asks the user questions, which is the thing a diff review cannot do. `compact-memory-index` keeps its own job: the harness's `MEMORY.md`, which _is_ a file.

### Profile dialogs: accrual, not management

The list row shows `Used N times · N lessons` (silent at zero), and the editor's Profile tab carries a read-only count plus the **Remember lessons** switch, pointing at Context Management for the rest. A deliberate scope limit: enough that you would not delete a profile casually, and no CRUD.

### Transfer on delete

Deleting a profile that has lessons asks a **three-way question** instead of a yes/no confirm (`personality-memory-transfer-sheet.tsx`): transfer them to another profile, discard them deliberately, or cancel. Lessons are the only part of a profile that took real work to produce and there is no undo. Zero lessons keeps the plain confirm - a decision sheet about nothing is an extra click.

- The destination list puts **same-role profiles first** (roster order within each group) because that is overwhelmingly the intent: you are replacing a Coder with another Coder. Pure reordering, nothing excluded - a user moving a Coder's lessons onto an Orchestrator may know something the role tags do not.
- Transfer **merges** into the destination rather than renaming the file: the destination usually already has lessons, and clobbering them to save a merge would destroy exactly what this operation exists to preserve. Near-duplicates merge with their reinforcement counts **added**, because two profiles independently learning the same thing is stronger evidence than either alone. Moved entries get fresh ids (a reused id collides the second time the same lessons are transferred) and are stamped `source: "transfer"` + `transferredFrom`.
- **Memory resolves before the roster write.** Reversing that order would delete the owner of a store nobody can then hand over; a failed transfer leaves both the profile and its lessons intact. An old client deleting a profile without this flow orphans the file rather than destroying it.

### Provider parity

Nothing here is Claude-shaped. The tools ride the daemon MCP catalog, injection sits above every provider adapter, and the review loop runs inside the agent's own session - so a local LM Studio model gets this exactly as a hosted frontier API does. No daemon-side generation is involved; anything model-assisted added later resolves through `resolveStructuredGenerationProviders`, the same chain Refine and the mini-tasks use.

### Considered and rejected

Kept because "we thought about it and said no" is the only useful form of a deleted idea, and each of these looks reasonable enough to be proposed again.

| Rejected                                     | Why                                                                                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory tiers** (off / simple / structured) | A tier is bookkeeping the user has to think about - the same failure as making recording hard, aimed at the user instead of the agent. One switch, one representation. |
| **A memory index plus a `recall` tool**      | Costs a tool and a round trip, and makes remembering conditional on the model choosing to look. The entry set is capped and small, so the full text goes in.           |
| **Editing in the profile editor**            | Context belongs in one place, and the editor would need the list and diff tooling that surface does not have. The editor shows accrual; Context Management manages.    |
| **A scheduled consolidation pass**           | `review_lessons` _is_ the consolidation pass, and it asks the user. An unattended rewrite of behavioural rules is the one thing worth never automating.                |
| **A shared per-team memory pool**            | A team is a selection of profiles, not an identity that learns. If it becomes one, it gets its own store keyed by team id.                                             |
| **A new `ContextCategory` for memory**       | That schema is a `z.enum` travelling daemon→client; a new member breaks older clients. `otto_injected` is what the weight actually is.                                 |
| **A new `OTTO_TOOL_GROUPS` value**           | Same reason, in the other direction: a new client could send `"memory"` to an older daemon that cannot parse it. The tools live in `agents`.                           |

## Otto tooling

Profiles are first-class in the agent-management MCP tools, so multi-agent skills can say "spawn a Worker and a Judger" without hardcoding providers:

- **`create_chat`** gained an optional `personality` arg (by name; one of provider/profile required). It resolves against the caller cwd's provider snapshot and expands to provider/model/effort/mode/systemPrompt; explicit sibling fields override per-field. Hard-fails when the profile is missing or out of commission.
- **`list_agent_profiles`** enumerates the roster (name, roles, availability, resolved brain, plus the `tier`/`canLaunch`/`guidance` decision-aid). **Open to every agent** - profiles are aware of each other, and any agent can enumerate the roster and spawn any profile by name (profile-named spawns are just another way to pick a provider/model/effort). No role gates this; the coordinator/focused tier only steers behavior in-context (see [Role tiers](#role-tiers-coordinators-vs-focused-workers)).
- **`create_schedule` / `update_schedule`** accept a `personality` arg; a bound schedule re-resolves against the run's workspace each run and hard-fails on unavailability.

Separately from the MCP tools, the **`agentPersonalities.get_stats`** WebSocket RPC serves per-profile spawn counts from a separate atomic-write stats file under `$OTTO_HOME/stats/` (not `config.json` - avoids spamming the config-changed broadcast). Spawns are counted at the `AgentManager.createAgent` choke point (`onPersonalitySpawn`), so composer, MCP `create_chat`, and schedule runs all increment. The editor surfaces "Used N times" per row.

The five `skills/*/SKILL.md` files teach role-aware discovery: committee prefers contrasting `advisor`/`judger`, advisor prefers `advisor`, handoff prefers `coder`, loop maps worker→`coder`/verifier→`judger`.

## Editor

Profiles are authored in the **Agent profiles** card (Host settings → Agents, `agent-personalities-section.tsx`), feature-gated on `features.agentPersonalities`. It reads/writes the roster via `useDaemonConfig`, so every save round-trips through `daemon-config-store.ts` and hot-reloads to all connected clients.

- **List rows** show name, `provider · model · roles`, a live `BlobLoader` in the row's spinner colors, "Used N times" (from `agentPersonalities.get_stats`) and "N lessons" (from `personality.memory.stats`, silent at zero - see [Memory](#memory-accrued-lessons)). Rows for out-of-commission profiles are grayed out with a reason via the shared `checkProfileAvailability` predicate - the same availability logic the pickers use.
- **Edit modal** (`PersonalityEditModal`) is **tabbed** (the form grew long) - a `SegmentedControl` across three tabs, all editing the one `draft` (fields are conditionally rendered, so switching tabs never loses in-progress edits), with the Cancel/Save actions pinned below the tabs:
  - **Identity** - name, profile-prompt textarea, respect-global-append toggle, role chips with an **All / None** toggle, and the two spinner **color inputs** (wheel + hex text) with a live `BlobLoader` preview.
  - **Model** - provider → model → mode → effort pickers sourced from the live providers snapshot.
  - **Voice** - the **TTS voice picker** (from `getSpeechSettingsOptions`, shown only when the host exposes voices) plus the **Voice cues editor**: the cue groups (Starting / Thinking / Waiting / Completed), each an editable list of short lines (add/remove, stable-id keyed rows), with a **"Generate with AI"** button that authors a set from the draft's name + prompt via the `visualizer.voiceCues.generate` RPC. **On save, empty cues are auto-generated** (best-effort - a generation failure saves without cues rather than blocking). See [Voice cues](#voice-cues).

The editor enforces the invariants that make a profile safe to reference:

- **Unique name, case-insensitive.** Names are load-bearing keys (spawn-by-name, running-agent selection), so a draft that collides with any other profile's name blocks save and shows an inline error. The check excludes the profile being edited.
- **Valid hex spinner colors.** Glow colors flow into daemon config, SVG gradients, and the `BlobLoader`; a hand-typed color must parse as hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) before save is enabled - the invalid input shows destructive styling and its swatch stays empty. The color wheel always emits valid values.
- **Double-submit lock.** Save awaits the config round-trip with the button locked, so a double-click can't mint a duplicate profile; the parent unmounts the modal on success and surfaces save errors itself.
- **Dirty-discard confirm.** Cancel/backdrop-close on a modified draft confirms before discarding (exact dirty check via a stringify of the JSON-safe draft against its initial value); a pristine draft closes immediately.
- **Concurrent-edit safety.** If the profile being edited vanishes from the roster mid-edit (deleted from another client), save re-appends it instead of silently dropping the mapped update.

## Starter team

A fresh host seeds a **starter team** so the editor opens with a working, role-complete roster instead of empty. Single source of truth: `DEFAULT_AGENT_PERSONALITIES` in `packages/protocol/src/default-personalities.ts`, imported by the daemon (first-run seeding) and the app (restore button). Six profiles, all Claude, covering all 8 roles: **Atlas** (orchestrator, chatter), **Sage** (advisor), **Vera** (judger), **Pixel** (artificer), **Dash** (writer, scheduler - the fast Haiku scribe for commit messages/summaries/names), **Sprocket** (chatter, coder).

Seeding is first-run-only and delete-safe: `bootstrap.ts` seeds the in-memory roster only when the persisted `agents.agentPersonalities` section is **absent** (distinct from an empty roster the user cleared), then `seedDefaultPersonalitiesIfAbsent` records it on disk once, writing only the profiles branch. Once the section exists on disk (even empty), seeding is a permanent no-op - **deleting the whole team sticks across restarts.** The editor shows "Add starter team" in the empty state and "Restore starter team (N missing)" as a footer, re-adding only builtins whose stable `personality_builtin_*` id is missing.

## Where the code lives

- **Shared (app + daemon):** `packages/protocol/src/messages.ts` (`AgentProfileSchema` incl. `memoryEnabled`, `PROFILE_ROLES`, the `agent.personality.set` and `personality.memory.*` schemas), `agent-profiles.ts` (role helpers, availability predicate), `default-personalities.ts`, `effort.ts`.
- **Daemon:** `packages/server/src/server/agent/agent-profiles.ts` (resolution + snapshot), `agent-manager.ts` (`setAgentPersonality` live switch, `prepareSessionConfig` memory injection), `session/agent-config/agent-config-session.ts` (the `agent.personality.set` RPC envelope), providers' optional `applyPersonality` (`providers/claude/agent.ts`, `providers/openai-compat-agent.ts`), `daemon-config-store.ts` (persistence/seeding), `tools/otto-tools.ts` (`create_chat`/`list_agent_profiles`, the three memory tools), `ProfileStatsStore`, `agent/voice-cue-generator.ts` + `agent/profile-prompt-generator.ts` (the two editor-time authoring passes, both on the Writer chain).
- **Memory (daemon):** `packages/server/src/server/agent/personality-memory/` - `types.ts`, `personality-memory-store.ts` (file-backed, serialized RMW), `lesson-dedup.ts`, `memory-brief.ts` (the pure composer), `personality-memory-service.ts` (the façade every caller talks to). Wired in `bootstrap.ts`; RPCs handled in `session.ts`.
- **App:** `packages/app/src/screens/settings/agent-personalities-section.tsx` (editor), `screens/settings/personality-memory-transfer-sheet.tsx` (transfer on delete), `components/combined-model-selector.tsx` (picker section), `hooks/use-personality-selection.ts`, `provider-selection/personality-form.ts`, `composer/agent-controls/index.tsx` (`useRunningChatPersonality`, the running-agent live switch).
- **Memory (app):** `packages/app/src/context-management/` - `use-personality-memory.ts` (RPC hooks), `use-context-personality.tsx` (the panel's bundled wiring), `personality-selector.tsx`, `memory-list.tsx`.
