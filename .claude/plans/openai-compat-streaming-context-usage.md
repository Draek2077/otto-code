# Plan: Stream Context Usage Updates for OpenAI Compatible Provider

## Problem

When running a long-running task with the OpenAI compatible provider, the context usage metrics (token count, context window fill percentage) do not update until the entire agent turn completes. The meter stays stale throughout the duration of tool rounds and model streaming.

## Root Cause

The OpenAI compatible provider (`openai-compat-agent.ts`) captures usage data from the server during each model round (via `delta.usage` in the final SSE chunk), but it **never emits a `usage_updated` event**. Usage only reaches the client at the very end of the turn via `buildTurnUsage()` → `turn_completed`.

Other providers (Claude, Codex, OpenCode, Pi) all emit `usage_updated` events during streaming, which the agent manager at `agent-manager.ts:3064` handles by updating `agent.lastUsage` and calling `emitState()` to push real-time context usage to the client.

### Relevant Files

| File                                                                | Role                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/server/src/server/agent/providers/openai-compat-agent.ts` | Target of the fix — add `usage_updated` emission                                       |
| `packages/server/src/server/agent/agent-sdk-types.ts`               | Defines `AgentStreamEvent` including `usage_updated` and `AgentUsage`                  |
| `packages/server/src/server/agent/agent-manager.ts`                 | Handles `usage_updated` → updates `agent.lastUsage` → calls `emitState()`              |
| `packages/server/src/server/agent/providers/claude/agent.ts`        | Reference implementation — `ClaudeContextUsageState.buildStreamUsageEvent()`           |
| `packages/app/src/composer/index.tsx`                               | Client-side consumer of `lastUsage.contextWindowUsedTokens` / `contextWindowMaxTokens` |

## Implementation Steps

### 1. Add `emitStreamUsageUpdated()` helper method to `OpenAICompatAgentSession`

Location: `openai-compat-agent.ts`, alongside `applyStreamPayload`

```typescript
/**
 * Emit a usage_updated event so the agent manager updates agent.lastUsage
 * and pushes the context usage to the client immediately, rather than
 * waiting for turn_completed at the end of the entire tool loop.
 */
private emitStreamUsageUpdated(turn: ActiveTurn): void {
  if (!turn.usage) {
    return;
  }
  const usage: AgentUsage = { ...turn.usage };
  if (typeof turn.usage.inputTokens === "number") {
    usage.contextWindowUsedTokens = turn.usage.inputTokens + (turn.usage.outputTokens ?? 0);
  }
  this.emit({
    type: "usage_updated",
    provider: this.provider,
    usage,
    turnId: turn.turnId,
  });
}
```

### 2. Call `emitStreamUsageUpdated()` when usage arrives in `applyStreamPayload`

Location: `openai-compat-agent.ts`, inside `applyStreamPayload`

Change:

```typescript
// Before:
if (delta.usage) {
  turn.usage = delta.usage;
}

// After:
if (delta.usage) {
  turn.usage = delta.usage;
  this.emitStreamUsageUpdated(turn);
}
```

### 3. Consider emitting `contextWindowMaxTokens` in the stream event

The Claude provider includes `contextWindowMaxTokens` in its `usage_updated` events when known. The OpenAI compat provider resolves this lazily via `resolveContextWindowMaxTokens()` (async). Two options:

- **Option A (simple):** Omit `contextWindowMaxTokens` from streaming events. The client already caches this value from the model catalog, and `buildTurnUsage` includes it in the final `turn_completed` usage. The streaming events carry `contextWindowUsedTokens` which is the dynamic part.
- **Option B (complete):** If `this.contextWindowMaxTokens` has already been resolved, include it in the emitted usage.

**Recommendation:** Option B for completeness, guarded by the existing field:

```typescript
if (this.contextWindowMaxTokens !== null) {
  usage.contextWindowMaxTokens = this.contextWindowMaxTokens;
}
```

### 4. Add unit tests

Location: `packages/server/src/server/agent/providers/openai-compat-agent.test.ts`

Test cases to add:

- **Streaming usage emits `usage_updated`:** Verify that when a stream chunk contains `usage`, a `usage_updated` event is emitted with the correct `contextWindowUsedTokens`.
- **Multiple model rounds emit incremental usage:** Verify that in a multi-round tool loop, each round's usage chunk triggers a separate `usage_updated` event.
- **`contextWindowMaxTokens` included when resolved:** Verify the field is present in `usage_updated` when the context window has been discovered.

## Verification

1. Run existing tests to confirm no regressions:
   ```bash
   npx vitest packages/server/src/server/agent/providers/openai-compat-agent.test.ts
   ```
2. Run the new tests added in step 4.
3. Manual verification: Start an OpenAI compatible agent with a long-running task (multiple tool rounds) and observe the context usage meter updating after each model round completes.

## Risks & Mitigations

| Risk                                                                               | Mitigation                                                                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emitting too many `usage_updated` events could cause excessive `emitState()` calls | Usage chunks arrive only once per model round (in the final SSE chunk), so this matches existing provider behavior                                  |
| `emitState()` broadcast overhead                                                   | The agent manager already handles this for Claude/Codex/Pi providers without issue                                                                  |
| Double-counting with `turn_completed` usage                                        | The agent manager overwrites `agent.lastUsage` — it's a snapshot, not cumulative. The final `turn_completed` usage is still the authoritative total |
