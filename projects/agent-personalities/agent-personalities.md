# Agent Personalities — charter

Status: **COMPLETE** (design locked 2026-07-10; all steps built + verified, uncommitted). Build sequence below. The one intentionally-open item is the _client schedule-form_ personality binding (Step 5b-client) — a product decision, since it would change the Step-4 schedule picker's semantics from ephemeral auto-fill to a persisted re-resolve-per-run binding; the capability itself is fully deliverable via the MCP `create_schedule`/`update_schedule` tools.

- [x] **Step 1 — Schema + persistence + capability flag.** `agentPersonalities` on `MutableDaemonConfig` + patch (`protocol/messages.ts`), `PERSONALITY_ROLES`/`AgentPersonality` exports, persisted `agents.agentPersonalities` with merge/load round-trip (`persisted-config.ts`, `daemon-config-store.ts`, `config.ts`, `bootstrap.ts`), `features.agentPersonalities` emitted. Round-trip + delete-to-empty covered by `daemon-config-store.test.ts`. Effort and roles are plain strings on the wire (daemon validates against its catalog) for forward-compat. Typecheck/lint/test green.
- [x] **Step 2 — Config UI (personalities editor card).** `agent-personalities-section.tsx` in the host settings "Agents" section, feature-gated on `agentPersonalities`. List of personalities (name, provider·model·roles, live `BlobLoader` in each row) with add/edit/delete; editor modal with name, provider→model→mode→effort pickers (from the providers snapshot), personality-prompt textarea, respect-global-append toggle, role chips + All/None, two spinner color inputs with a live `BlobLoader` preview, and a **TTS voice picker** (sourced from `getSpeechSettingsOptions`, shown only when the host exposes voices). Rows use the shared `checkPersonalityAvailability` predicate to gray out + explain unavailable personalities. Reads/writes via `useDaemonConfig`. Effort scale lifted to `protocol/effort.ts` (`EFFORT_LEVELS`), server `effort-levels.ts` re-exports it. Typecheck/lint green (i18n deferred — English-only pending a translation pass).
- [x] **Step 3 — Resolution engine.** Pure availability predicate + role helpers in `protocol/agent-personalities.ts` (shared by app pickers and daemon); full effort-aware resolution + snapshot blob in `server/agent/agent-personalities.ts`. `resolvePersonality(personality, entries)` → `{ status: "available", snapshot }` or `{ status: "unavailable", code, reason }`. Effort resolves the stored canonical level to the model's nearest option (surfacing `effortMatch`/`effortDegraded`); mode falls back to the provider default; roles normalized to the known set. 11 unit tests green.
- [x] **Step 4 — Pickers.** Effort resolution lifted to `protocol/effort.ts` (`resolveEffortOption` + friends), server `effort-levels.ts` is now a re-export shim so app + daemon share one resolver. App-side `resolvePersonalityForForm` (`provider-selection/personality-form.ts`, unit-tested) resolves a personality → `{provider, model, modeId, thinkingOptionId}` using the shared availability + effort primitives. `usePersonalitySelection` (`hooks/use-personality-selection.ts`) filters the roster by role, computes availability, and on select applies values via the form setters (deviation keeps identity; explicit clear or switching personalities detaches). `CombinedModelSelector` gained optional personality props + a **Personalities section at the top of the "all" view** (mini `BlobLoader` per row, availability graying, selected check, tap-selected-to-clear); single-provider bypass is suppressed when a roster is present. **Wired into all three surfaces:** artifact create sheet (Artificer, ignores mode, trigger shows personality name), schedule form sheet (Scheduler, ignores mode — unattended), and the composer draft controls (Chatter, applies mode — attended; only the draft/new-chat path, never the running-agent `AgentControls`, so a live agent never gains a mid-stream switcher). **Picker memory**: last-used personality id per role persisted device-locally (`FormPreferences.lastPersonalityByRole`, `mergeLastPersonality`); on mount the picker re-selects the remembered personality only when it is available AND its resolved values still match the form's current selection (identity-only restore, never a forced re-apply); any explicit select/clear freezes further auto-preselection. Typecheck/lint/format green, 5 resolver tests pass.
- [x] **Step 5 — MCP tooling.** `create_agent` gained a `personality` arg (provider is now optional — one of provider/personality required). `resolveCreateAgentBrain` (in `otto-tools.ts`) looks the personality up by name (exact then case-insensitive), resolves it against the caller cwd's provider snapshot via `resolvePersonality`, and expands to provider/model/effort/mode/systemPrompt — with explicit provider/settings overriding **per-field**. Hard-fails loudly (no fallback) when the personality is missing or out of commission. The resolved `ResolvedPersonalitySnapshot` is snapshotted onto the agent: new field `AgentSessionConfig.personalitySnapshot`, persisted via `SERIALIZABLE_CONFIG_SCHEMA` + `buildSerializableConfig`, re-hydrated (roles re-normalized) in `buildStoredAgentConfig` — round-trip tested. `respectGlobalAppendPrompt: false` now suppresses the daemon-global append in `AgentManager.applyDaemonAppendSystemPrompt`. New **`list_personalities`** tool (name, roles, availability, resolved provider/model/effort/mode), gated — like personality spawns — to callers born from an **Orchestrator** personality (top-level user sessions always allowed). Roster threaded via `OttoToolHostDependencies.readAgentPersonalities` (bootstrap reads `daemonConfigStore.get().agentPersonalities`). Server+CLI build, typecheck, lint, format green; projections round-trip + config-store + resolution tests pass.
- [x] **Step 6 — Identity wiring (spinner + voice + telemetry).** **Spinner:** the personality's two spinner colors now ride onto the agent's **live thinking indicator**. New optional `AgentSnapshotPayload.personalitySpinner` (protocol, purely additive — absent ⇒ theme default); the server projects `agent.config.personalitySnapshot?.spinner` onto both the live (`toAgentPayload`) and stored/rehydrated (`buildStoredAgentPayload`) payloads; the app threads it payload → `normalizeAgentSnapshot` → store `Agent` → `selectChatAgentState`/`ChatAgentStateShape` → `AgentScreenAgent` → `view.tsx` → `TurnFooter` → `WorkingIndicator`, which renders `BlobLoader` with the personality's `glowA`/`glowB` (falling back to `ThemedBlobLoader` when absent). This is the first per-agent color path for the live spinner (previously theme-global only). **Voice playback (was the charter's known-hard piece):** an optional per-utterance `SpeechVoiceOverride` (`{name, model?}`) now threads through `TextToSpeechProvider.synthesizeSpeech(text, voice?)` → `TTSManager.generateAndWaitForPlayback(..., voice?)` → `synthesizeSegment` → the provider. Sherpa resolves the personality voice's name to a speaker id via `resolveLocalTtsSpeakerId(model, name)` (soft binding — a voice bound to a different model or an unknown name falls back to the host default); OpenAI honors the name only if it's a valid OpenAI voice, else falls back; the worker-backed local provider carries the override as a per-call IPC arg (not part of the config cache key). The `voice-session.ts` speak handler loads the caller agent, reads `config.personalitySnapshot?.voice`, and passes it down — so a personality agent speaks in its own voice in realtime voice mode. **Telemetry:** a `PersonalityStatsStore` (separate atomic-write JSON file under `$OTTO_HOME/stats/`, NOT config.json — avoids spamming `status:daemon_config_changed`) counts personality spawns; `create_agent` increments via `OttoToolHostDependencies.recordPersonalitySpawn`; a new `agentPersonalities.get_stats` read RPC (protocol + `session.ts` handler + `daemon-client.ts` method, wired via `wsServer.setPersonalityStatsProvider`) serves the counts; the editor surfaces "Used N times" per row via a `useFetchQuery` hook. Full monorepo typecheck, targeted lint/format, TTS + schedule + projections tests all green.
- [x] **Step 7 — Skills integration.** The five `skills/*/SKILL.md` files (plain markdown, hash-synced, no build step) now teach role-aware personality discovery: the shared **otto** reference documents the `personality` arg on `create_agent` + the Orchestrator-gated `list_personalities` tool + the 7 roles (and notes personalities supersede provider-category preferences); **committee** prefers contrasting `advisor`/`judger` personalities; **advisor** prefers an `advisor` personality; **handoff** prefers a `worker` personality; **loop** maps worker→`worker`/verifier→`judger` (CLI primitive, provider flags — role mapping documented, no false `--personality` claim).
- [x] **Step 5b — Schedule personality binding (server + tools).** Optional `personality` on the schedule new-agent config (`protocol/schedule/types.ts`, additive) + `UpdateScheduleNewAgentConfig`. The run path (`schedule/service.ts` `executeSchedule`) re-resolves a bound personality against **the run's workspace cwd** each run via `resolveSchedulePersonalityBrain` → `resolvePersonality`, injecting provider/model/effort/mode/systemPrompt + snapshot (via `applyScheduleBrain`), and **hard-fails the run** (surfaced through the existing failure path → `finishRun`) when the personality is missing/unavailable — so runs pick up personality edits between runs. `ScheduleService` gained optional `providerSnapshotManager` + `readAgentPersonalities` deps (wired in bootstrap). Authoring via MCP: `create_schedule`/`update_schedule` gained a `personality` arg (`buildScheduleNewAgentConfig` reuses `resolveCreateAgentBrain` to validate + fill the required provider at create time). 59 schedule tests pass. **Open (product decision):** persisting a binding from the _client_ schedule form — would flip the Step-4 schedule picker from ephemeral auto-fill to a persisted re-resolve-per-run binding; deferred pending that UX call.

## What this is

An **Agent Personality** is a named, reusable template stored per-host in the daemon config. Each personality binds:

- a **provider → model** pair,
- a **canonical effort level** (`off`…`max`, resolved to the model's nearest advertised option at spawn),
- a **default permission mode**,
- a **personality prompt** (fills the per-agent `systemPrompt`),
- a **"respect global append prompt" toggle** (whether the daemon-wide `appendSystemPrompt` still stacks on top),
- one or more **roles**,
- an **identity**: a name, two spinner colors, and a **TTS voice** (spoken identity).

Personalities become the primary way a user picks "who does the work." They appear as a section **at the top of every model picker** (chat, artifacts, schedules); selecting one auto-fills the underlying provider/model/effort/mode fields, which the user may still override by hand. The raw provider/model lists stay for full flexibility — personalities are the ergonomic default, not a replacement.

Personalities are also **first-class in the Otto agent-management tooling**: an orchestrating agent can enumerate them and spawn agents by personality (bound by stable ID), so multi-agent skills (committee, panels, handoff, loop, advisor) can say "spawn a Worker and a Judger" without hardcoding providers.

The North-Star fit (per [CLAUDE.md](../../CLAUDE.md)): this is provider-agnostic leveling-up. A personality bound to a local LM-Studio model is as capable a "Chatter" or "Judger" as one bound to a frontier API.

## The data model

A new `agentPersonalities` section on `MutableDaemonConfig`. Closest existing template to copy is `MutableStructuredGenerationProviderSchema` (`{ provider, model?, thinkingOptionId? }`) used by `metadataGeneration` — a personality is that shape plus identity, roles, mode, and prompt.

```
AgentPersonality {
  id: string                    // stable, machine-generated; the ONLY thing references bind to
  name: string                  // human label, freely renamable, must be unique per host
  provider: string              // provider id (e.g. "codex", "openai-compat")
  model: string                 // provider-scoped model id
  effortLevel: EffortLevel      // canonical: off|minimal|low|medium|high|xhigh|max
  modeId: string                // default permission mode (provider-scoped)
  personalityPrompt?: string    // → per-agent systemPrompt
  respectGlobalAppendPrompt: boolean  // default true; false = personality prompt stands alone
  roles: PersonalityRole[]      // one or more
  spinner: { glowA: string; glowB: string }  // two hex colors for BlobLoader
  voice?: { provider: string; model: string; name: string }  // TTS voice; self-describing (names are per-engine/model). Soft binding — degrades to host default if unavailable, never gates availability
}
```

- **Effort is stored canonical, resolved at spawn.** Store `EffortLevel` (from `effort-levels.ts` `EFFORT_LEVEL_SCALE`), never a raw `thinkingOptionId` — option ids differ per model. Resolve with `resolveEffortOption` / `resolveEffortAgainstModels` against the bound model at spawn time.
- **Identity is the ID, never the name.** Renaming "Sparky" → "Blaze" must not break any schedule, remembered picker selection, or in-flight agent. Everything binds `id`.
- Both the schema and its patch variant go in `packages/protocol/src/messages.ts` alongside `MutableDaemonConfigSchema` / `MutableDaemonConfigPatchSchema`, both `.passthrough()`. Follow the protocol-compat rules: new fields `.optional()`, no `.transform()`/`.catch()` on wire schemas.

### Roles (7, per-personality one-or-more)

| Role             | Where it's consumed                                                                            | App picker surface today                     |
| ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Chatter**      | Interactive agent chats                                                                        | Composer agent-controls picker               |
| **Artificer**    | Creating & managing artifacts                                                                  | Artifact create sheet                        |
| **Scheduler**    | Creating & managing schedules                                                                  | Schedule form sheet                          |
| **Worker**       | Spawned as a sub-agent (incl. text-editor AI refactor — "Refactor" folds into Worker)          | None yet — via skills/MCP                    |
| **Judger**       | Judging / review passes                                                                        | None yet — via committee/review skills       |
| **Advisor**      | Planning / second opinion, **read-only/advisory**                                              | None yet — via advisor/committee skills      |
| **Orchestrator** | Drives multi-agent workflows; **only role permitted to enumerate & spawn other personalities** | None yet — via committee/panels/handoff/loop |

Roles gate visibility by the obvious logical mapping: a Chatter appears in the chat composer's personality section, an Artificer in the artifact sheet, a Scheduler in the schedule sheet. Worker/Judger/Advisor/Orchestrator have no dedicated app picker yet — they are consumed by **skills** through the Otto agent-management tooling (the list tool + spawn-by-personality). A per-personality **All / None** toggle sets all roles at once. A new personality defaults to **All roles**.

## Availability ("out of commission")

A personality is **available on a given host + workspace (cwd)** only if every bound setting resolves against the live providers snapshot there:

- provider is present, enabled, and authenticated,
- the bound model exists in that provider's snapshot,
- the bound `modeId` exists among that provider's mode options.

If any fails, the personality is **out of commission**:

- **In pickers:** grayed out with a reason (e.g. "Blaze — LM Studio not connected"), not selectable.
- **In automation (schedules, spawn-by-name):** **hard-fail with a visible, named error.** No fallback to another model/provider — this follows the repo's no-fallback-paths rule. A schedule pointed at an out-of-commission personality fails its run loudly rather than silently substituting.

Availability is evaluated against the providers snapshot (`provider-snapshot-manager.ts` / `use-providers-snapshot.ts`), which already distinguishes resolvable vs selectable provider statuses.

## Lifecycle & resolution semantics

**Spawn snapshots the personality onto the agent.** At spawn the personality is resolved to a concrete settings blob — `{ personalityId, resolved provider/model/thinkingOptionId/modeId/systemPrompt/respectGlobalAppendPrompt, spinner colors }` — stored on the agent record. From then on that agent is frozen to its snapshot.

- **Editing a personality never mutates an in-flight or observe-only agent.** Running streams, and read-only observed agents, keep the settings they were born with until they finish. This is the explicit hard requirement: observed/unassisted agents must not change mid-stream.
- **New jobs re-resolve.** Any fresh spawn from the personality picks up the current (edited) settings.
- **Interactive chat re-resolves at the next user turn.** When a stream completes and the user sends another message, that turn re-resolves from the current personality (so edits land between turns) — but the just-finished stream is never retroactively changed.

## Override semantics

- **Tooling / spawn-by-name:** the template applies verbatim. A caller may override individual fields **only when explicitly requested** — no heuristic or "logical" substitution. (E.g. "Sparky but max effort" overrides effort only; everything else stays template.)
- **UI deviation:** selecting a personality fills the picker with its defaults. The user may then hand-edit any field (an explicit per-field override). **The agent keeps the personality identity** — name, spinner colors, prompt — with the overridden brain/settings layered on. Only an explicit "clear personality" detaches it back to a plain provider/model selection. _(This preserves the visual identity through deviation — the spinner still shows Sparky's colors. Confirm this is the intended UX before building the composer wiring.)_

## Otto tooling changes

- **`create_agent` accepts a personality.** Add an optional `personality` (by name for ergonomics, resolved to `id`) to `commonCreateAgentInputSchema` in `otto-tools.ts`. When present it expands to provider/model/effort/mode/systemPrompt; explicit sibling fields override per the rule above. The per-agent `systemPrompt` field already exists end-to-end (`agent-sdk-types.ts`), so the personality prompt has a ready carrier.
- **New list tool.** An Otto tool that enumerates personalities (name, roles, availability, resolved provider/model). **Gated to the Orchestrator role** — only an orchestrating agent may enumerate and spawn other personalities. Advisor stays read-only/advisory and cannot.
- **Schedules** already parse `provider`/`provider/model` + `modeId`/`thinkingOptionId` (`resolveScheduleProviderAndModel`); a scheduled agent bound to a personality resolves the same way, subject to the availability hard-fail above.
- **`appendSystemPrompt` composition:** honor the personality's `respectGlobalAppendPrompt`. When false, the personality prompt is the whole system prompt; when true, the daemon-global append still stacks (current behavior).

## Identity (visual + audio)

- **Visual (v1):** name + two spinner colors. Bind them to `BlobLoader`'s `glowA`/`glowB` (`packages/app/src/components/blob-loader.tsx`); the themed wrapper reads `spinnerPrimary`/`spinnerSecondary` theme tokens today. An agent spawned from a personality renders its thinking spinner in the personality's two colors — the one wiring path is snapshot colors → the agent's thinking indicator.
- **Audio (voice):** a personality can carry a TTS `voice` (`{ provider, model, name }`), captured in the editor from the host's `getSpeechSettingsOptions` and flowed through the resolution snapshot. **Capture is done; playback is deferred.** The TTS runtime bakes the voice into a singleton provider at init — `TextToSpeechProvider.synthesizeSpeech(text)` takes no voice arg (`packages/server/src/server/speech/speech-provider.ts`), and both providers hold the voice as instance state (`providers/local/sherpa/sherpa-tts.ts`, `providers/openai/tts.ts`). Making a personality's voice actually play means threading a per-utterance `voice`/`speakerId` through `synthesizeSpeech` + `TTSManager.generateAndWaitForPlayback` + `voice-session.ts` (Sherpa's `generate({ sid })` already accepts a per-call speaker, so the local path is cheap; OpenAI takes voice per request). Voice only plays in realtime **voice mode** today — there is no read-chat-aloud path. A "preview this voice" control would need a new `speech.tts.preview` RPC (none exists). This wiring lands in Step 6.
- Deferred: choosing among an animation _set_, and any identity surface beyond the spinner (track rows, chat header, agent list).

## Telemetry

- **Per-personality usage counter** (spawn count) for troubleshooting. Store in a small **separate stats file**, not in `config.json` — incrementing a config entry on every spawn would spam the persisted config and its `status:daemon_config_changed` broadcast. Increment cheaply out-of-band; surface in the personalities editor.

## Picker memory

- Selecting a personality becomes the **remembered picker selection** (device-local `use-form-preferences.ts`), so the next create form reopens with that personality preselected — remembered by `id`, healing gracefully to "unavailable" if the personality was deleted or is out of commission. **Shipped in Step 4.** Stored per role in `FormPreferences.lastPersonalityByRole` (keyed by role string, not the enum, so this device store never has to move with the role vocabulary). Restore is **match-gated**: on mount the picker re-selects the remembered id only if that personality is available and its resolved provider/model/effort (+mode for attended surfaces) equals what the form currently shows — so memory never re-applies values or shows a name that has drifted from the actual selection. An explicit user select/clear freezes auto-preselection for the life of the picker (prevents clear-then-instantly-re-select).

## Systems touched (file map)

- **Protocol/schema:** `packages/protocol/src/messages.ts` — `agentPersonalities` on `MutableDaemonConfigSchema` + patch; `PersonalityRole` enum; new `features.agentPersonalities` on `ServerInfoStatusPayloadSchema.features`.
- **Daemon config persistence:** `packages/server/src/server/daemon-config-store.ts` — **add an `agentPersonalities` branch to `mergeMutableConfigIntoPersistedConfig`**, or the section lives only in memory and silently fails to survive restart (`.passthrough()` keeps unknown keys in memory but the merge whitelist decides what's written). Load path: `config.ts` / `persisted-config.ts`.
- **Config RPC + hot reload:** `session.ts` (`get_daemon_config` / patch handlers, `status:daemon_config_changed`); register `daemonConfigStore.onFieldChange("agentPersonalities", …)` in `bootstrap.ts`.
- **Effort resolution:** `packages/server/src/server/agent/effort-levels.ts` (`resolveEffortOption`, `EFFORT_LEVEL_SCALE`).
- **Availability source:** `provider-snapshot-manager.ts` / `use-providers-snapshot.ts`.
- **MCP tooling:** `packages/server/src/server/agent/tools/otto-tools.ts` (`create_agent`, `commonCreateAgentInputSchema`, `resolveScheduleProviderAndModel`, new list tool), `agent/create-agent/create.ts`, per-agent `systemPrompt` in `agent-sdk-types.ts`.
- **Pickers (single shared stack):** `packages/app/src/components/combined-model-selector.tsx`, `composer/agent-controls/index.tsx`, `hooks/use-agent-form-state.ts`, `provider-selection/resolve-agent-form.ts` (inject personality defaults as `FormInitialValues`), `provider-selection/provider-selection.ts`. Reused by `components/artifacts/artifact-create-sheet.tsx` and `components/schedules/schedule-form-sheet.tsx`.
- **Config UI:** a new personalities editor card in `packages/app/src/screens/settings/host-page.tsx` (sibling to `speech-settings-cards.tsx`, `providers-section.tsx`), reading/writing via `hooks/use-daemon-config.ts`.
- **Capability gate:** emit `features.agentPersonalities = true` in `packages/server/src/server/websocket-server.ts`; consume via `packages/app/src/runtime/host-features.ts`. Tag the gate `// COMPAT(agentPersonalities): added in v0.1.X`.
- **Spinner:** `packages/app/src/components/blob-loader.tsx`, tokens in `packages/app/src/styles/theme.ts`.
- **Picker memory / telemetry:** `packages/app/src/hooks/use-form-preferences.ts` (remember by id); new daemon-side stats file for usage counts.

## Build sequence (proposed)

1. **Schema + persistence + capability flag** — `agentPersonalities` on config (protocol + store merge + hot reload), `features.agentPersonalities`. Round-trips to disk and survives restart. No UI yet.
2. **Config UI** — personalities editor card in the host settings page: CRUD, role toggles (All/None), spinner color pickers, respect-append toggle, live availability badges.
3. **Resolution engine** — server-side "resolve personality → concrete settings against a cwd" (effort mapping, availability check, snapshot blob). Shared by pickers and tooling.
4. **Pickers** — personality section at the top of `CombinedModelSelector`, gated by role per surface (Chatter/Artificer/Scheduler); auto-fill + explicit-override + keep-identity-on-deviation; picker memory by id.
5. **MCP tooling** — `create_agent` by personality name, Orchestrator-gated list tool, spawn snapshot on the agent record, `respectGlobalAppendPrompt` composition, schedule hard-fail on unavailable.
6. **Visual identity + telemetry** — thread snapshot spinner colors into the thinking indicator; wire the usage counter + surface it.
7. **Skills** — teach committee/panels/handoff/loop/advisor to discover and refer to personalities by role via the list tool (separate follow-up; may become its own project file here).

## Open questions / to confirm before building

- **UI deviation identity** (see Override semantics): confirm that hand-editing a field after selecting a personality _keeps_ the personality identity (name/colors/prompt) rather than detaching to plain provider/model.
- **Mode is a request, not a guarantee.** Permission modes are provider-scoped, and some spawn paths (artifacts/schedules) only honor unattended modes. A personality's default mode is applied where valid and may be down-graded by those paths — document rather than fight.
- **Skills integration** (step 7) is sketched, not designed. Likely deserves its own file in this folder once the core lands, mirroring `observed-subagents/provider-adapters.md`.
