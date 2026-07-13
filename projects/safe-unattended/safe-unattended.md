# Safe Unattended Runs

Charter, 2026-07-13. Make Otto handle scheduled/background work the way Claude Code itself does: **never bypass for unattended runs — deny-by-default with pre-approval, plus Claude's own Auto classifier where the model supports it.** Schedules and artifacts become internal, surfacing to the user only when something is actually wrong. Provider-agnostic; Claude is the proof.

## Why not bypass

`bypassPermissions` tells the CLI to skip prompts entirely — the daemon never sees the action, so no guardrail is possible. Giving every scheduled/artifact agent bypass means a bad prompt or hallucinated command can do anything the user can. The user's constraint (verbatim): "There must be a better way where only some types of actions are ok, but it wouldn't be able to 'delete had drive' or something malicious. But we also need the system to perform unattended tasks."

## Researched facts (2026-07-13, Claude Code docs + vendored SDK)

- The Agent SDK we embed supports a **`dontAsk`** permission mode: "Don't prompt for permissions, deny if not pre-approved" (`sdk.d.ts` PermissionMode). This is Claude Code's own headless posture — anything covered by permission allow-rules or built-in read-only behavior runs; the rest is **denied, never stalls**.
- **Auto mode** = rules first → read-only-in-cwd auto-approve → model classifier → classifier "ask" escalates to the host's `canUseTool` (our `handlePermissionRequest`). In an SDK embedding _we_ answer the escalation.
- Auto mode support matrix: Anthropic API → Opus 4.6+/Sonnet 4.6+; Bedrock/Vertex/claude.ai sign-in → Sonnet 5, Opus 4.7, Opus 4.8 only; **never** on Haiku, Sonnet ≤4.5, Opus ≤4.5, claude-3. No runtime discovery — the CLI errors mid-session ("auto mode unavailable for this model"); we mirror the matrix (`autoModeSupport` in `model-manifest.ts`).
- The SDK emits a dedicated **auto-denied event** (classifier deny, dontAsk deny, deny rule) so hosts can render the denial — our "true problem" signal, for free. It also exposes `decision_reason_type` (e.g. `safetyCheck`, `classifier`) on escalations so policy can key off _why_ it escalated.
- Claude Code desktop scheduled tasks: permission prompts configurable per task; headless `-p` runs deny-if-not-pre-approved; in `-p` auto mode, repeated blocks abort the session (no user to ask). Cloud Routines run autonomously.
- Sandbox (`sandbox-exec`/bubblewrap) is macOS/Linux/WSL2 only — **not native Windows** — and covers Bash only. Not a foundation we can rely on cross-platform.

## Phases

### Phase 0 — Auto-mode eligibility + hiding (DONE 2026-07-13, uncommitted)

- `model-manifest.ts`: `autoModeSupport: "all" | "anthropic-api" | "none"` per model; manifest builder stamps `supportsAutoMode: false` on the wire for the deterministic "none" tier only (Haiku today). Auth-path-dependent tiers are checked per session (env is well-defined there, not in the global catalog).
- `checkClaudeAutoModeSupport(modelId, env)` in `claude/agent.ts`: none → refuse; all → allow everywhere (Bedrock/Vertex included, per current docs — this relaxed the old blanket Bedrock/Vertex block); anthropic-api/unknown → Bedrock/Vertex refuse, and anthropic-api additionally requires `ANTHROPIC_API_KEY` (best available API-vs-subscription signal). Unknown models fail open.
- `getAvailableModes()` computed per call → Auto hidden from the in-chat mode control for unsupported models. `setMode`/`buildOptions` assert with the specific reason. Deliberately **no silent coercion** at create — a stale auto request fails the turn visibly.
- Protocol: additive optional `supportsAutoMode` on `AgentModelDefinition` (interface + zod).
- Client: `provider-selection/mode-support.ts` (`filterModesForModel` / `coerceModeForModel`); create-form option list intersects provider modes × selected model; reducer drops a selected Auto on model switch; personality form falls back to provider default.

### Phase 1 — `dontAsk` as the unattended target

- Add `dontAsk` to Claude `DEFAULT_MODES` with `isUnattended: true`, **listed before** `bypassPermissions` — `resolveDefaultAgentCreateConfig` picks the first unattended mode as the coercion target, so schedules/loops/artifacts flip from bypass → dontAsk by list order alone (the unattended-coercion fix already landed in `create-agent-mode.ts`). Bypass stays available as an explicit choice.
- Baseline allow-rules for unattended runs (SDK `permissions.allow` / allowedTools): Otto MCP tools (the Team Scheduler's whole job), read-only tools (already auto-approved in cwd), workspace-scoped Edit/Write. Everything else — arbitrary Bash included — is denied and the agent adapts or reports. Needs a real schedule run to tune the set.
- UI label per glossary; description must say "denies anything not pre-approved" (guardrail-bearing description, same principle as preview tools).

### Phase 2 — Auto mode for unattended runs + the deny-responder

- Unattended target selection becomes per-model: Auto when `checkClaudeAutoModeSupport` passes, else `dontAsk`. (Auto is NOT marked `isUnattended` — attended users chat in Auto; needs a provider hook like `resolveUnattendedModeId(model, env)` rather than the static flag.)
- **Unattended responder:** for agents created `unattended: true`, `handlePermissionRequest` answers classifier escalations immediately — deny with reason (optionally allow the same baseline set) — instead of broadcasting a permission attention. Never stalls, never notifies for routine denials.
- Surface the SDK auto-denied event as a timeline entry so the transcript shows what was blocked and why.

### Phase 3 — Internal schedules + surface-only-on-problem

- Schedule-run agents become `internal: true` (artifacts already are) → no attention broadcasts from the agent itself; the **owning service** owns failure detection (schedule `waitResult.status === "error"`, artifact failed state) and now also "hit a guardrail denial".
- Hidden-workspace flag + promote-on-error + reveal-kept-runs + sidebar scroll preservation: already designed, see memory `scheduled-runs-sidebar-noise` for exact edit points. A guardrail denial (Phase 2) is a promote trigger alongside hard failure.
- Artifact nuance: posture is **per-run** — a user-triggered artifact refresh (client watching) may run attended; schedule-triggered refreshes run guarded-unattended.

### Phase 4 — Provider parity

- openai-compat: same responder over the existing `read`/`interact`/`execute` classification (`openai-compat-otto-tool-permissions.ts`) — read/interact auto-allow, execute deny-unless-allowlisted. The daemon executes tools directly, so enforcement is native.
- Codex/Copilot/OpenCode/Pi: map "guarded unattended" onto each provider's nearest primitive (Codex sandbox/approval policy; OpenCode auto-accept feature has no unattended mode — today it's a coercion no-op). Track per provider like `projects/observed-subagents/provider-adapters.md`.

## Open questions

- Exact Phase 1 allow-rule set (needs a live Team Scheduler run against dontAsk to see what it actually requires).
- Whether guardrail denials should promote immediately or only when the run also fails (a run that adapts and succeeds may not warrant an exclamation — maybe a quieter badge).
- Live model switching doesn't re-emit `availableModes` for Claude (no mode_changed event from the provider); Phase 2 should refresh modes after `setModel`/personality switch.

### Deferred decision — schedule-run agent visibility (2026-07-13)

Phase 3 shipped schedule-run agents with the artifact-generator treatment: `internal: true` + `observable: true` + post-run `closeAgent` teardown. This is broader than pure attention suppression, because `internal` conflates three behaviors in agent-manager — (1) hidden from listings, (2) never persisted, (3) no attention broadcasts. The user accepted the full treatment for now; **review later whether schedule agents should instead stay listed/persisted (narrow attention-suppression only)**. Surface-by-surface comparison:

| Surface                                        | internal/ephemeral (shipped)                                                                       | listed/persisted (alternative)                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sidebar workspace list                         | hidden during run, revealed on error/keep (workspace `hidden` flag — independent of this decision) | same                                                                                                            |
| Agent listings (sidebar agent rows)            | never appears (`listAgents` filters internal)                                                      | appears as a normal agent                                                                                       |
| CLI `otto ls`                                  | never appears (internal + not persisted)                                                           | appears                                                                                                         |
| Schedules panel run rows (status/output/error) | still show (schedule store owns these)                                                             | still show                                                                                                      |
| Open the agent from a run row                  | 404 — agent not persisted, closed after run                                                        | works                                                                                                           |
| After daemon restart                           | agent gone entirely (never persisted)                                                              | survives (persisted)                                                                                            |
| Clean-finish attention ping                    | none (internal skips attention)                                                                    | needs a narrow suppress mechanism (e.g. skip finished-attention for `unattended` agents) or the ping comes back |

If the review flips to listed/persisted: drop `internal`/`observable`/`closeAgent` from the schedule createAgent path, restore workspace-archive-driven agent teardown for archiveOnFinish, and add the narrow finished-attention skip keyed on `unattended`. The workspace `hidden` flag work is decision-independent and stays either way.
