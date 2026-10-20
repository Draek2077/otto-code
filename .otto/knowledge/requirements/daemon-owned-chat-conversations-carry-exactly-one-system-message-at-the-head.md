---
id: "daemon-owned-chat-conversations-carry-exactly-one-system-message-at-the-head"
kind: "requirement"
title: "Daemon-owned chat conversations carry exactly one system message, at the head"
status: "proposed"
tags: ["brain","openai-compat","chat-templates","llama.cpp"]
created_at: "2026-08-19T16:44:01.695Z"
updated_at: "2026-08-19T16:44:01.695Z"
---
# Daemon-owned chat conversations carry exactly one system message, at the head

<!-- compiled_truth -->

Every /chat/completions request the daemon-owned tool loop sends must contain at most one system message, and it must be the first message. Qwen and GLM chat templates raise the Jinja exception "System message must be at the beginning" for a system message at any later index, and llama.cpp returns that as HTTP 500 on that request and on every subsequent request over the same conversation, so the chat is dead rather than degraded. Anything the loop needs to inject mid-conversation (subdirectory instruction files, nudges, repair prompts) rides as a user message. The invariant is enforced at three points in packages/server/src/server/agent/providers/openai-compat-agent.ts: injection creates user-role messages, resume rewrites system-role instruction messages persisted by older builds to user role (restoreMessage), and toWireMessages demotes any stray later system message immediately before the request is serialized.

## Timeline

- time: "2026-08-19T16:44:01.695Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-19T16:44:01.695Z"
  kind: "evidence"
  summary: "Reported twice by the user against Otto Brain: `Otto Brain responded 500 to /chat/completions: {\"error\":{\"code\":500,\"message\":\"... While executing CallExpression at line 110, column 28 ... raise_exception('System message must be at the beginning ... Jinja Exception: System message must be at the beginning.\"}}`. Introduced by a46ffc2b3, which injected a touched subtree's AGENTS.md as a system message at the round boundary; the live injection was changed to user role in aa1df013b. The second report came from a conversation persisted with the system-role message still in it: resume kept it, so every later request 500'd. Covered by tests in openai-compat-agent.test.ts: the `toWireMessages` describe (demotion), `expectSystemMessageOnlyAtHead` on the subtree-instruction requests, and \"a conversation persisted with system-role instructions resumes wire-valid\"."
