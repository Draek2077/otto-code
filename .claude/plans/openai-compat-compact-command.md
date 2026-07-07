# Plan: Implement `/compact` for OpenAI-Compatible Providers

## Problem

OpenAI-compatible providers (LM Studio, Ollama, vLLM, llama.cpp, etc.) have **no built-in slash commands**. Their `listCommands()` only returns MCP prompts — if no MCP servers are configured, it returns `[]`. This means features like `/compact` are entirely absent, even though every other first-class provider (Claude, Codex, OpenCode, Pi) supports them.

Users typing `/compact` in an OpenAI-compatible session get no autocomplete, no command resolution — the raw text is just sent to the model as a normal prompt.

## Goal

Implement `/compact <instruction>` as a built-in slash command for the OpenAI-compatible provider, allowing users to condense conversation history to free up context window space.

## Context & Research

### How other providers handle compaction

| Provider     | Mechanism                 | Detail                                                                                                                                                           |
| ------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude**   | SDK-native                | Claude CLI handles compaction internally; the provider just emits timeline events from SDK callbacks (`compact_boundary` messages with `preTokens`/`postTokens`) |
| **Codex**    | App-server-native         | Codex app server handles compaction internally; the provider emits timeline events from `thread/compacted` notifications                                         |
| **OpenCode** | `session.summarize()` RPC | Calls the OpenCode SDK's `summarize()` method, which replaces the session's conversation history                                                                 |
| **Pi**       | SDK-native                | Pi SDK handles compaction internally                                                                                                                             |

### Why OpenAI-compat is different

The OpenAI-compatible provider has **no external binary or SDK** — the daemon itself is the agent runtime. It talks to HTTP endpoints directly via `POST /chat/completions`. There is no external compaction service to delegate to. The daemon must implement compaction **in-process**:

1. The daemon holds the full `ChatMessage[]` array in memory
2. The daemon sends this array to the model on each tool loop round
3. Compaction means asking the model to summarize the conversation, then replacing the message array with the condensed version

### Existing types

The agent SDK already defines everything needed on the timeline/event side:

```typescript
// agent-sdk-types.ts
interface CompactionTimelineItem {
  type: "compaction";
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

interface AgentSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: "command" | "skill";
}
```

## Design

### Command definition

```typescript
const COMPACT_COMMAND: AgentSlashCommand = {
  name: "compact",
  description: "Compress the conversation history to free up context space",
  argumentHint: "[instruction]",
  kind: "command",
};
```

- **Name:** `compact` (matches Claude/Codex convention)
- **Kind:** `"command"` (not `"skill"` — it's a session control operation)
- **Argument:** Optional free-text instruction to guide the summarization (e.g., `/compact focus on the remaining bugs`)

### Compaction algorithm

Since there's no external compaction service, the algorithm runs entirely in the daemon:

```
1. Intercept `/compact [instruction]` in executeTurn() before sending to model
2. Emit timeline event: { type: "compaction", status: "loading", trigger: "manual" }
3. Estimate pre-compaction token count from current message array
4. Build a compaction prompt:
   - Include a system prompt asking the model to summarize the conversation
   - Include the user's optional instruction if provided
   - Include a condensed representation of the conversation history
5. Send compaction prompt to the model (single non-streaming or streaming request)
6. Parse the model's summary response
7. Replace the message array:
   - Keep the system message (index 0) — rebuilt on next turn anyway
   - Replace all user/assistant/tool messages with a single user message
     containing the summary, plus a short assistant acknowledgment
8. Estimate post-compaction token count
9. Emit timeline event: { type: "compaction", status: "completed", trigger: "manual", preTokens, postTokens }
10. Emit usage_updated event with the compaction's token usage
11. Resolve the turn successfully (compact is a self-contained turn)
```

### Compaction prompt template

The compaction prompt sent to the model should look like:

```
You are asked to summarize the following conversation history concisely.
Preserve all important context: decisions made, code changes, errors encountered,
current task state, and any unresolved issues.

<conversation>
[user]: First user message...
[assistant]: Assistant response...
[user]: Second user message...
[assistant]: Assistant response with tool calls...
...
</conversation>

<User instruction>: <optional user instruction from /compact args>

Provide a concise summary that captures the essential context needed to
continue the conversation productively.
```

### Message replacement strategy

After compaction, the `messages` array becomes:

```typescript
[
  { role: "system", content: "<rebuilt system prompt>" }, // index 0
  { role: "user", content: "<model-generated summary>", messageId: randomUUID() },
  {
    role: "assistant",
    content: "Conversation history has been compacted.",
    messageId: randomUUID(),
  },
];
```

This mirrors what OpenCode's `session.summarize()` does internally — it replaces the full history with a summary that preserves continuity.

## Implementation Plan

### Phase 1: Define the slash command and register it

**File:** `packages/server/src/server/agent/providers/openai-compat-agent.ts`

1. Define `COMPACT_COMMAND` constant matching `AgentSlashCommand` interface
2. Update `listCommands()` to always include `COMPACT_COMMAND` in addition to MCP prompts:
   ```typescript
   async listCommands(): Promise<AgentSlashCommand[]> {
     const commands: AgentSlashCommand[] = [COMPACT_COMMAND];
     if (this.mcpManager) {
       const prompts = await this.mcpManager.listPrompts();
       commands.push(...prompts.map(/* ... */));
     }
     return commands;
   }
   ```

### Phase 2: Add slash command resolution in `executeTurn()`

**File:** `packages/server/src/server/agent/providers/openai-compat-agent.ts`

1. Add a `resolveSlashCommandInvocation()` method (patterned after Codex/OpenCode):
   - Parse `/command args` from the prompt text
   - Check if the command name matches a known built-in command (`compact`)
   - Return `{ commandName, args }` or `null`

2. In `executeTurn()`, before `resolveMcpPromptText()`:
   ```typescript
   const slashCommand = this.resolveSlashCommandInvocation(promptText);
   if (slashCommand && slashCommand.commandName === "compact") {
     await this.handleCompact(turn, slashCommand.args ?? null, userMessageId);
     return;
   }
   ```

### Phase 3: Implement `handleCompact()`

**File:** `packages/server/src/server/agent/providers/openai-compat-agent.ts`

Add a private `handleCompact()` method:

1. **Emit loading event:**

   ```typescript
   this.emit({
     type: "timeline",
     provider: this.provider,
     turnId: turn.turnId,
     item: { type: "compaction", status: "loading", trigger: "manual" },
   });
   ```

2. **Estimate pre-token count** using the existing `estimateTokens()` helper on all non-system messages.

3. **Build compaction input:**
   - Serialize the conversation (user/assistant messages, tool call summaries) into a text blob
   - Construct a system prompt for the compaction request
   - Include the user's optional instruction

4. **Send compaction request to the model:**
   - Use the same HTTP endpoint and headers as normal turns
   - Non-streaming request (simpler parsing) or streaming with collection
   - Extract the summary text from the response

5. **Replace message history:**

   ```typescript
   this.messages.length = 0;
   this.messages.push({ role: "system", content: this.buildSystemPrompt(this.config) });
   this.messages.push({ role: "user", content: summary, messageId: randomUUID() });
   this.messages.push({
     role: "assistant",
     content: "Conversation history has been compacted.",
     messageId: randomUUID(),
   });
   ```

6. **Emit completed event** with pre/post token counts:

   ```typescript
   this.emit({
     type: "timeline",
     provider: this.provider,
     turnId: turn.turnId,
     item: { type: "compaction", status: "completed", trigger: "manual", preTokens, postTokens },
   });
   ```

7. **Emit usage event** for the compaction request tokens.

8. **Resolve the turn** with a final text like `"Conversation history compacted successfully."`

### Phase 4: Add tests

**File:** `packages/server/src/server/agent/providers/openai-compat-agent.test.ts`

1. **`listCommands` includes compact:**
   - Verify `COMPACT_COMMAND` appears in the list even without MCP servers
   - Verify it coexists with MCP prompts when configured

2. **`/compact` resolves and compacts:**
   - Mock the HTTP endpoint to return a known summary
   - Verify the message array is replaced
   - Verify timeline events are emitted (`loading` → `completed`)
   - Verify pre/post token counts are reported

3. **`/compact` with optional instruction:**
   - Verify the instruction is included in the compaction prompt

4. **`/compact` on a short conversation:**
   - Should still work (no-op or trivial compaction)

5. **`/compact` fails gracefully on endpoint error:**
   - Verify `turn_failed` event is emitted
   - Verify message history is NOT modified

### Phase 5: Integration with context usage tracking

**File:** `packages/server/src/server/agent/providers/openai-compat-agent.ts`

The provider already tracks `contextWindowMaxTokens` and `lastContextTokens`. After compaction:

1. Update `lastContextTokens` to the post-compaction estimate
2. The context usage bar in the UI will reflect the reduced count via the `usage_updated` event

## File Changes Summary

| File                                                                     | Change                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/server/agent/providers/openai-compat-agent.ts`      | Add `COMPACT_COMMAND`, update `listCommands()`, add `resolveSlashCommandInvocation()`, add `handleCompact()` |
| `packages/server/src/server/agent/providers/openai-compat-agent.test.ts` | Add test suite for compact command                                                                           |

## Risks & Mitigations

| Risk                                                 | Mitigation                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Compaction prompt is large for long conversations    | Truncate oldest messages first; keep recent context intact. Use a sliding window approach.            |
| Model returns a poor summary                         | The user can start a fresh session with `/clear` if needed. The compaction is best-effort.            |
| Endpoint doesn't support the compaction request size | Detect response errors and fall back to `turn_failed` with a clear message.                           |
| Token estimates are inaccurate                       | The existing `estimateTokens()` (chars/4) is already used for this purpose. Acceptable approximation. |

## Future Considerations

- **Auto-compaction:** When context usage exceeds a threshold (e.g., 80% of context window), automatically trigger compaction. This would require a `trigger: "auto"` compaction event.
- **`/compress` alias:** Some providers use `/compress` instead of `/compact`. Could add as an alias.
- **Incremental compaction:** Instead of summarizing the entire history, compact only the oldest portion and keep recent messages intact for better context fidelity.
