---
id: "mid-session-context-injection-is-a-per-provider-switch-defaulting-on"
kind: "decision"
title: "Mid-session context injection is a per-provider switch, defaulting on"
status: "proposed"
tags: ["brain","openai-compat","context-management","provider-settings"]
created_at: "2026-08-19T18:23:55.700Z"
updated_at: "2026-08-19T18:23:55.700Z"
---
# Mid-session context injection is a per-provider switch, defaulting on

<!-- compiled_truth -->

Anything the daemon-owned tool loop adds to a conversation after it has started is governed by one per-provider switch, `midSessionContextUpdates` (Agents tab: "Mid-session context updates"). It defaults to on, so the shipped behavior is unchanged, and turning it off stops the loop collecting touched paths at all, so nothing is resolved, read or appended. The switch is deliberately generic rather than named for the subdirectory instruction loader that is its only client today: a small local context window is the reason it exists, and any future mid-conversation injection rides under the same gate rather than adding a second one. Providers whose conversation Otto does not own (every ACP/CLI provider) are outside its scope entirely; they read their own instruction files in their own process, which is also why the spawn-time chain is gated on `ownsContextPayload`.

## Timeline

- time: "2026-08-19T18:23:55.700Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["daemon-owned-chat-conversations-carry-exactly-one-system-message-at-the-head"]
- time: "2026-08-19T18:23:55.700Z"
  kind: "evidence"
  summary: "Requested after the second \"System message must be at the beginning\" 500, on the grounds that injecting into a local session is expensive whatever the role: local models have limited context. Implemented as `ProviderOverrideSchema.midSessionContextUpdates` (packages/protocol/src/provider-config.ts), gated on the `openaiCompatMidSessionUpdates` capability flag (COMPAT, v0.8.11), enforced at the single choke point `noteSubtreeInstructionCandidates` in openai-compat-agent.ts, surfaced in the provider sheet's Agents tab, and documented in docs/context-management.md and docs/custom-providers.md. Test: \"injects nothing when the provider turns mid-session context updates off\"."
