---
id: "finding-agent-sdk-capability-audit"
kind: "finding"
title: "Agent SDK capability audit: @openai/codex-sdk vs @anthropic-ai/claude-agent-sdk"
status: "proposed"
tags: ["providers","sdk","codex","claude","sessions","permissions","dated-snapshot"]
created_at: "2026-08-23T03:02:11.816Z"
updated_at: "2026-08-23T03:02:11.816Z"
---
# Agent SDK capability audit: @openai/codex-sdk vs @anthropic-ai/claude-agent-sdk

<!-- compiled_truth -->

A dated side-by-side audit of what the two vendor agent SDKs expose, and where each one falls short of Otto's provider-neutral needs. Captured 2025-11-14 against `@openai/codex-sdk` 0.58.0 and `@anthropic-ai/claude-agent-sdk` 0.1.37. Both version pins are long superseded, so treat every specific API name below as a snapshot to re-verify, not as current truth.

**@openai/codex-sdk (0.58.0).** Entry point is `Codex`/`Thread`. `Codex.startThread()` spawns the bundled `codex` CLI and returns a `Thread` handle issuing `run()` or `runStreamed()`. `Thread.runStreamed()` yields JSONL `ThreadEvent`s (agent messages, reasoning, file changes, MCP tool calls, command executions, web searches, todo lists) that map one-to-one with CLI telemetry, so full turn telemetry is available without ACP. Session persistence is `Codex.resumeThread(id)`, with rollouts stored by the CLI in `~/.codex/sessions`. Session config rides in `ThreadOptions`: `model`, `sandboxMode` (`read-only|workspace-write|danger-full-access`), `approvalPolicy`, `modelReasoningEffort`, `networkAccessEnabled`, `webSearchEnabled`, `workingDirectory`, `skipGitRepoCheck`.

Codex gaps: no public API to enumerate supported modes/models or to switch modes mid-session, because options are fixed per `Thread`; MCP servers cannot be injected dynamically, since the CLI discovers them from `codex` config rather than SDK APIs; thread metadata (title, timestamps) is not exposed, so richer state requires scraping Codex's manifest.

**@anthropic-ai/claude-agent-sdk (0.1.37).** Primary surface is the `query()` helper returning an `AsyncGenerator<SDKMessage>` (`SDKAssistantMessage`, `SDKPartialAssistantMessage`, `SDKSystemMessage`, `SDKToolProgressMessage`). The control plane is built into the generator: `interrupt()`, `setPermissionMode()`, `setModel()`, `setMaxThinkingTokens()`, plus introspection via `supportedCommands()`, `supportedModels()`, `mcpServerStatus()`, `accountInfo()`. The final `SDKResultMessage` carries usage, total cost, and `permission_denials`. Sessions resume via `options.resume`, with `forkSession` to avoid mutating the original log. Hooks observe `SessionStart`, `SessionEnd`, `PreToolUse`. Config covers `agents`, `permissionMode`, `allowedTools`/`disallowedTools`, `systemPrompt`, `plugins`, `mcpServers` (stdio/SSE/HTTP or in-process via `createSdkMcpServer`). Tool gating is first-class through the `canUseTool` callback, which returns allow/deny plus `PermissionUpdate` persistence suggestions.

Claude SDK gaps: prompts are consumed via `query()` calls rather than a long-lived per-session object, so Otto must wrap it to keep stateful handles; there is no built-in session manifest, so persistence is Otto's job using the `session_id` present on every message; there are no sandbox/approval tiers equivalent to Codex's `sandboxMode`, so `permissionMode` plus permission rules carry that weight instead.

The durable cross-cutting point that outlives the version pins: the two SDKs disagree on where session state and permission policy live. Codex fixes options per thread and owns its own rollout store; Claude exposes a mutable control plane but owns no session manifest. Any provider-neutral session and permission layer in Otto has to supply the half each vendor omits.

## Timeline

- time: "2026-08-23T03:02:11.816Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-23T03:02:11.816Z"
  kind: "evidence"
  summary: "Migrated verbatim from `packages/server/src/server/agent/agent-sdk-capabilities.md`, which had lived inside the server source tree since commit b2c89df7c (2025-11-14) and was removed during the 2026-08-22 repository file-hygiene sweep. Original content was read from the vendored type declarations: `node_modules/@openai/codex-sdk/dist/index.d.ts` and `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. Version pins at capture time were codex-sdk 0.58.0 and claude-agent-sdk 0.1.37; the latter has since been bumped past 0.3.x, so API specifics require re-verification before use."
