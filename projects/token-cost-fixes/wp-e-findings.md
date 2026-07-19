# WP-E · Wire behavior toggles into subsystems — findings

Status: **implemented**, `build:server` + `typecheck` (all packages) + `lint` (all changed
files) green. Scoped test `mcp-server.test.ts` down to the pre-existing failures only (see
§4). Working tree left uncommitted for review.

WP-A owns the config chain and already ships the fields WP-E reads
(`agentBehaviors.{promptSuggestions,agentProgressSummaries,notifyOnFinishDefault}`, all
default `true`, on `MutableDaemonConfig` / `OttoDaemonConfig`, persisted, capability flag
`server_info.features.agentBehaviorToggles`). WP-E only **reads** them + adds the live
hot-reload hook WP-A explicitly deferred.

---

## 1. Where each flag is read

### `promptSuggestions` (Claude only)

- **Read at:** `packages/server/src/server/agent/providers/claude/agent.ts`,
  `ClaudeAgentSession.resolvePromptSuggestionsEnabled()`, consumed in `buildOptions()` where
  the base `ClaudeOptions.promptSuggestions` was hard-coded `true`.
- **Two independent off paths** (either one disables):
  1. Daemon toggle `agentBehaviors.promptSuggestions === false`.
  2. CLI env kill-switch `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` (checked against
     `this.launchEnv` first, then `process.env`; case-insensitive `"false"`).
- Default preserved: absent config + no env → `true` (unchanged).

### `agentProgressSummaries` (Claude only)

- **Read at:** same file, `resolveAgentProgressSummariesEnabled()`, consumed in
  `buildOptions()` where `ClaudeOptions.agentProgressSummaries` was hard-coded `true`.
- Off path: `agentBehaviors.agentProgressSummaries === false`. When off, observed-subagent
  rows keep free tool-level activity (transcript tailing) but lose the ~30s AI progress blurb.
- Default preserved: absent → `true`.

### `notifyOnFinishDefault` (Otto tool default, provider-neutral)

- **Read at:** `packages/server/src/server/agent/tools/otto-tools.ts` via
  `agentManager.getAgentBehaviors().notifyOnFinishDefault`, in two handlers:
  - `create_agent` → `resolveCreateAgentNotifyOnFinish(resolvedArgs)` (extracted helper;
    agent-scoped omission falls back to the toggle, top-level omission stays `false`).
  - `send_agent_prompt` → `resolvedNotifyOnFinish = notifyOnFinish ??
agentManager.getAgentBehaviors().notifyOnFinishDefault`.
- **Schema change (own file, not the daemon config schema):** the two _agent-scoped_ tool
  input schemas (`agentToAgentInputSchema.notifyOnFinish`,
  `agentToAgentSendAgentPromptInputSchema.notifyOnFinish`) dropped their `.default(true)` and
  are now bare `.optional()`. This is required: `parseToolInput` applies zod `.default()`, so
  with a schema default the handler could never distinguish "caller omitted" from "caller
  explicitly passed true", and the toggle would have no effect. Moving the default into the
  handler makes it config-driven while **per-call args still override** (an explicit
  `notifyOnFinish` short-circuits the `??`). Top-level schemas keep `.default(false)` — they
  never notify anyway (no caller agent to notify), so the daemon gate `callerAgentId && …`
  already zeroes them.
- Default preserved: absent config → `true`; agent-scoped caller that omits the arg → notified
  (exactly today's behavior).

---

## 2. Threading (how the values reach the read sites)

`AgentManager` is the single live holder, mirroring the existing `appendSystemPrompt` pattern:

- New resolved type `AgentBehaviorSettings` (three concrete booleans) in
  `agent/agent-sdk-types.ts`, added as optional `agentBehaviors` on `AgentLaunchContext`
  (runtime-only, never persisted).
- `AgentManager` gains: constructor option `agentBehaviors?`, private resolved field, module
  helper `resolveAgentBehaviorSettings` (absent/undefined field = on, matching WP-A's
  `readAgentBehaviors` "any non-false = on" rule), `setAgentBehaviors()` setter, and
  `getAgentBehaviors()` getter (read by the tool handlers).
- `buildLaunchContext()` stamps `context.agentBehaviors = this.agentBehaviors` onto every
  launch. `ClaudeAgentClient.createSession`/`resumeSession` forward
  `launchContext.agentBehaviors` into `ClaudeAgentSession`, stored as `this.agentBehaviors`
  and read in `buildOptions()`.

## 3. Hot-reload hook (WP-A's live pattern)

`bootstrap.ts`, next to the `mcp.injectIntoAgents` / `appendSystemPrompt` `onFieldChange`
handlers:

- Initial value passed to the `AgentManager` constructor as `agentBehaviors:
config.agentBehaviors`.
- `daemonConfigStore.onFieldChange("agentBehaviors", …)` → `agentManager.setAgentBehaviors(…)`.
  Because `changedFieldPaths` diffs the whole `agentBehaviors` object, a patch to any nested
  toggle fires the handler. New/resumed agents pick up `promptSuggestions` /
  `agentProgressSummaries` on their next launch (injected via `buildLaunchContext`);
  `notifyOnFinishDefault` is read live per tool call — no daemon restart needed.

## Provider parity (non-Claude behavior)

- `promptSuggestions` / `agentProgressSummaries`: **Claude-only.** They live on Claude's
  `ClaudeOptions`. Every other provider's `createSession`/`resumeSession` accepts the same
  `AgentLaunchContext` but simply never reads `launchContext.agentBehaviors` — silent no-op,
  no error. Turning the toggle off on a Codex/OpenCode/openai-compat host changes nothing for
  those agents (they don't have the capability), exactly per the reference-tier rule.
- `notifyOnFinishDefault`: **provider-neutral.** It's Otto's own tool default, applied in the
  shared `create_agent` / `send_agent_prompt` handlers, so it governs agent-to-agent
  notifications regardless of which provider the caller or child agent runs.

## 4. Verification

- `npm run build:server` — clean. `npm run typecheck` (all packages) — clean.
- `npm run lint -- <6 changed files>` — 0 warnings, 0 errors. (One transient `complexity`
  lint on the `create_agent` handler was resolved by extracting
  `resolveCreateAgentNotifyOnFinish`.)
- `npx vitest run src/server/agent/mcp-server.test.ts` — **118 passed, 3 failed, all
  pre-existing (none WP-E)**:
  - `create_agent > requires a concise title` and `> requires initialPrompt` — the 2 known
    bare-spawn failures flagged by WP-A (title/initialPrompt now optional).
  - `browser MCP tools > omits output schemas …` — WP-C's uncommitted `mcp-server.ts`
    `list_agents` reformat (output now `agents_count=0\n\n{"agents":[]}`; the test still
    expects the old spaced JSON). `mcp-server.ts` was **not** touched by WP-E.
  - Two assertions in `mcp-server.test.ts` that checked the _schema-level_ `notifyOnFinish:
true` default were updated to the new contract (schema no longer defaults it; the
    handler resolves it — behavioral default-on is still covered by the existing
    "returns notify-on-finish guidance" / guidance assertions). Added `getAgentBehaviors` to
    the test's `buildAgentManagerSpies` so agent-scoped calls that omit the arg resolve.

## Files touched

- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentBehaviorSettings` +
  `AgentLaunchContext.agentBehaviors`.
- `packages/server/src/server/agent/agent-manager.ts` — option, field, resolver, setter,
  getter, `buildLaunchContext` injection.
- `packages/server/src/server/agent/providers/claude/agent.ts` — session option, stored
  field, `resolvePromptSuggestionsEnabled` / `resolveAgentProgressSummariesEnabled`, base
  options wiring, forwarded from create/resume session.
- `packages/server/src/server/agent/tools/otto-tools.ts` — dropped agent-scoped
  `.default(true)`, `resolveCreateAgentNotifyOnFinish` helper, handler defaults from
  `getAgentBehaviors()`.
- `packages/server/src/server/bootstrap.ts` — initial `agentBehaviors` + `onFieldChange`
  hot-reload.
- `packages/server/src/server/agent/mcp-server.test.ts` — spy method + 2 assertion updates.
