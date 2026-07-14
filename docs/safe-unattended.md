# Safe unattended runs

Otto runs work with no human watching — scheduled runs, agent loops, artifact generation, and unattended-parent spawns. The rule for all of them: **never `bypassPermissions`.** A bypassed agent skips every prompt at the CLI, so the daemon never sees the action and no guardrail is possible — a bad prompt or hallucinated command could do anything the user can. Unattended runs instead adopt a **deny-by-default posture**: anything explicitly pre-approved runs, everything else is denied (never stalls, never notifies), and the run adapts or reports. Claude is the shipped proof; the enforcement half lives above the provider layer, so it already covers more than Claude.

The build history and the researched Claude Code / Agent-SDK facts that grounded this (auto-mode support matrix, `dontAsk` semantics, sandbox limits) lived in `projects/safe-unattended/` — shipped and folded in here. This doc is the durable architecture.

## The unattended posture

Two orthogonal creation-time flags on a managed agent drive everything:

- **`unattended: true`** — no client is watching to answer approval prompts. Set by the schedule runner, the artifact generator, loops, and unattended-parent spawns. Drives permission-mode coercion (below) and the daemon deny-responder.
- **`internal: true`** — the agent is hidden from listings, never persisted, and emits no attention broadcasts. Schedule-run and artifact-generator agents are both internal (plus `observable: true`, so a client that already knows the id can still watch a revealed run).

The two are independent: `unattended` governs _how permissions are answered_, `internal` governs _whether the agent is seen_.

## Permission modes: `dontAsk`, `auto`, and never `bypass`

Claude's mode list (`DEFAULT_MODES` in `packages/server/src/server/agent/providers/claude/agent.ts`, mirrored in the protocol manifest `packages/protocol/src/provider-manifest.ts`) is, in order: `default` (Always Ask), `acceptEdits`, `plan`, `auto`, **`dontAsk`**, `bypassPermissions`. Both `dontAsk` and `bypassPermissions` carry `isUnattended: true`; **`dontAsk` is listed first**, so `resolveDefaultAgentCreateConfig` picks it as the coercion target. That single ordering fact is what flips every unattended run from bypass to deny-by-default.

- **`dontAsk`** ("Don't Ask") — the Agent SDK's headless posture: runs without prompting, but anything not covered by a permission allow-rule is **denied rather than run**. Its description is deliberately guardrail-bearing ("Runs without prompting — actions not pre-approved are denied"), the same principle as the preview tools.
- **`dontAsk` is hidden and non-user-selectable.** In the manifest it is `userSelectable: false` — it never appears in any mode dropdown. `isUserSelectableMode(provider, modeId)` in `provider-manifest.ts` gates the pickers. It is _system-assigned only_: the coercion target for unattended runs and for Auto on models that can't run Auto. When it is a live agent's active mode, the mode control locks (`LockedAgentModeBadge` on the client) instead of offering a dropdown.

### Auto-mode eligibility and hiding

**Auto mode** = permission rules → read-only-in-cwd auto-approve → model classifier → classifier "ask" escalates to the host. Not every model can run it. `checkClaudeAutoModeSupport(modelId, env)` (in `claude/agent.ts`) is the authority:

- The catalog stamps `autoModeSupport: "all" | "anthropic-api" | "none"` per model; the wire carries `supportsAutoMode: false` only for the deterministic **`"none"`** tier (Haiku today).
- `"none"` → refuse. `"all"` → allow everywhere (Bedrock/Vertex included). `"anthropic-api"`/unknown → Bedrock/Vertex refuse, and `"anthropic-api"` additionally requires `ANTHROPIC_API_KEY` (the best available signal for API billing vs. claude.ai sign-in, which leaves no env marker). Unknown models fail open.
- `getAvailableModes()` filters Auto out of the in-chat mode control for unsupported models; `setMode`/`buildOptions` assert with the specific reason. There is **no silent coercion at create for an attended run** — a stale Auto request fails the turn visibly.
- On the client, `coerceModeForModel` (in `packages/app/src/provider-selection/mode-support.ts`) coerces a selected **Auto on a `supportsAutoMode: false` model (Haiku) to `dontAsk`**, not to Always Ask — a model that can't classify still gets the guarded posture rather than a stall.

### Unattended coercion at create

`resolveAndValidateCreateAgentMode` (in `packages/server/src/server/agent/create-agent-mode.ts`) enforces the posture when the agent is created `unattended: true`. An attended mode can leak in as an explicit request — a personality's default mode, a schedule's stored mode, a last-used chat preference — and honoring it would stall the run forever on the first prompt. So:

- A requested mode that is **not** already unattended is coerced to the provider's unattended target; an already-unattended request is kept.
- The target is **model-aware**: `preferredUnattendedModeId` upgrades `dontAsk` → `auto` when `checkClaudeAutoModeSupport` passes for the run's model + auth path, falling back to `dontAsk` otherwise. Claude computes this in its `resolveDefaultAgentCreateConfig` call; the base list-order target (`dontAsk`) is the fallback. The preferred target only wins when it is actually a mode the target provider exposes (`resolveEffectiveUnattendedTarget`).

## The daemon deny-responder

Coercing the mode is not enough: **Auto's classifier can still escalate** (its "ask" branch), and any provider that surfaces a `permission_requested` event would otherwise stall an unattended run forever with no one to answer. The responder closes that gap.

In `agent-manager.ts`, `onStreamPermissionRequested` checks the creation-time `unattended` flag (never the permission mode — an attended user in Auto still wants the prompt). For an unattended agent it calls `autoDenyUnattendedPermissionRequest`, which:

- responds `{ behavior: "deny", message }` through the exact same path a client's deny response takes (resolves the pending permission, refreshes state, continues the turn),
- emits **no attention broadcast and no notification** — routine denials are silent,
- records a guardrail denial via `recordGuardrailDenial`, bumping the per-agent counters **`guardrailDenials`** and **`lastGuardrailDenialAt`**.

**This lives above the provider layer.** It fires on any `permission_requested` stream event regardless of provider, so it already covers **Claude and the natively-tooled openai-compat provider today** — both surface permission requests through the same manager path. It is keyed purely on the `unattended` flag, so any future provider that emits permission requests is covered the moment it does.

## Internal, ephemeral schedules and artifacts

Both owning services create their agents `unattended: true` + `internal: true`, so a clean run is fully silent, and the **owning service owns failure detection** rather than the agent broadcasting attention.

- **Schedules** (`packages/server/src/server/schedule/service.ts`): a schedule run creates its workspace **hidden** (`hidden: true`, withheld from clients) and its agent internal + observable. On finish, exactly one of: archive-and-tear-down (clean run, `archiveOnFinish`), or **promote-on-error** — a failed run (`waitResult.status === "error"`) flips the hidden workspace visible so it surfaces in the sidebar, with scroll position preserved and kept runs revealed. Because internal agents are never persisted or listed, the runner explicitly `closeAgent`s the internal agent after the run (archive-by-workspace can't reach it).
- **Artifacts** (`packages/server/src/server/artifact/artifact-service.ts`): the generator is an ephemeral internal + unattended agent with no workspace, closed (not archived) when the HTML lands. Posture is **per-run**: a user-triggered artifact refresh (a client watching) may run attended, while a schedule-triggered refresh runs guarded-unattended. It resolves the provider's model-aware unattended mode exactly like the schedule runner, unless the user picked an explicit mode that is itself unattended.

## Deferred / not yet built

Three pieces were scoped but not shipped in Phases 0–3. They are recorded here so they survive deletion of `projects/safe-unattended/`.

1. **Guardrail-denial → promote hook + denial timeline entry (small).** `recordGuardrailDenial` bumps the counters but does not yet tell the owning schedule/artifact service to _reveal_ a run that hit a guardrail denial (only hard `error` failures promote today), nor does it write a timeline entry showing what was blocked and why. There is a `TODO(safe-unattended Phase 3)` at the denial site in `agent-manager.ts` (~L4108). Extracted as a pull-off task: **`projects/todos/unattended-denial-promote.md`**. Open sub-question: whether a denial should promote immediately or only when the run also fails (a run that adapts and succeeds may warrant only a quiet badge, not an exclamation).
2. **Deny-responder for the remaining providers (larger).** The responder covers Claude and openai-compat because both route permission requests through the manager. Codex, Copilot, OpenCode, and Pi need "guarded unattended" mapped onto each one's nearest primitive (Codex sandbox/approval policy; OpenCode's auto-accept has no unattended mode — today it's a coercion no-op; etc.). Track per provider like `projects/observed-subagents/provider-adapters.md` did.
3. **Schedule-agent visibility review (open decision).** Phase 3 gave schedule-run agents the full artifact treatment: `internal` (hidden from listings + never persisted + no attention broadcasts) + `observable` + post-run `closeAgent`. `internal` conflates three behaviors, so this is broader than pure attention suppression. Consequences of the shipped choice: schedule agents never appear in agent listings or `otto ls`, opening the agent from a run row 404s (not persisted, closed after run), and the agent is gone after a daemon restart. The **alternative** is listed/persisted schedule agents with only a narrow finished-attention suppression keyed on `unattended`. The user accepted the full treatment for now; revisit whether schedule agents should instead stay listed/persisted. The workspace `hidden` flag is decision-independent and stays either way.
