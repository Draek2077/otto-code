---
id: "injected-subdirectory-instructions-must-not-be-system-messages"
kind: "finding"
title: "Injected subdirectory instructions must not be system messages"
status: "proposed"
tags: ["otto-brain","openai-compat","context-management","chat-templates"]
created_at: "2026-08-19T03:39:38.533Z"
updated_at: "2026-08-19T03:39:38.533Z"
---
# Injected subdirectory instructions must not be system messages

<!-- compiled_truth -->

The openai-compat provider injected a touched subtree's AGENTS.md as a `role: "system"` message appended to the running conversation. Qwen and GLM chat templates raise `System message must be at the beginning` from Jinja for any system message after the first turn, so llama.cpp returned HTTP 500 on that request and on every request afterwards: the conversation stayed poisoned, and the affected Otto Brain chats were dead rather than degraded. Injected instruction files now ride as user messages carrying an explicit framing preamble, and exactly one system message at index 0 is a wire invariant of this provider.

## Timeline

- time: "2026-08-19T03:39:38.533Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-19T03:39:38.533Z"
  kind: "evidence"
  summary: "Observed 2026-08-18 on two live Otto Brain chats:\n\n`[System Error] Otto Brain responded 500 to /chat/completions: {\"error\":{\"code\":500,\"message\":\"While executing CallExpression at line 110, column 28 in source: ...eveloper\" %} {{- raise_exception('System message must be at the beginning...','type':'server_error'}}`\n\nCause, traced in `packages/server/src/server/agent/providers/openai-compat-agent.ts`:\n\n- `injectPendingSubtreeInstructions` pushed `{ role: \"system\", subtreeInstructionDir }` onto the tail of `this.messages` at the round boundary (shipped in a46ffc2b3, 2026-08-18).\n- `streamCompletion` sends `this.messages.map(toWireMessage)` in order, so the system message crossed the wire mid-conversation.\n- Second break site: the compaction rebuild re-inserted the pinned instruction messages at index 1+, directly after the rebuilt system prompt, which the same templates also reject.\n\nFix applied in the same file:\n\n- Injected instructions use `role: \"user\"`, with the preamble extended to say it is not a request to answer. Appending at the tail also leaves the cached prefix (system prompt + tool catalog + history) intact, which folding the text into `messages[0]` would have invalidated every injection.\n- `subtreeInstructionDir` is the identity, never the role: added `isInjectedSubtreeInstruction` and keyed compaction pinning, `reindexInjectedSubtreeInstructions`, `rebuildEventHistory` (so an injected file never replays as a user turn) and `repairDanglingToolCalls` (so it is not mistaken for a turn boundary) on it.\n- Compaction re-inserts pinned instructions after the summary and assistant ack, not ahead of them, to avoid three consecutive user messages at the head.\n- `isRetainedOnRestore` now drops every restored system message, which repairs already-poisoned sessions on resume: the file re-injects the next time the agent touches that subtree.\n\nVerification: `openai-compat-agent.test.ts` 127/127 pass, including a new `expectSystemMessageOnlyAtHead` assertion on both the injection and post-compaction requests. Server typecheck and lint clean."
