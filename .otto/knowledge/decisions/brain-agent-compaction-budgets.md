---
id: "brain-agent-compaction-budgets"
kind: "decision"
title: "Brain agents compact aggressively with bounded summaries"
status: "confirmed"
tags: ["otto-brain", "compaction", "token-economy", "local-models"]
created_at: "2026-08-12T03:46:47.651Z"
updated_at: "2026-08-12T03:46:47.651Z"
---

# Brain agents compact aggressively with bounded summaries

<!-- compiled_truth -->

Otto Brain uses local-model compaction defaults of 6,000 recent conversation tokens retained verbatim and a 4,000-token ceiling on the generated handoff summary. The summary prompt prioritizes concise actionable state over transcript preservation. These defaults apply only to the built-in `otto-brain` provider; provider overrides may set `compaction.keepRecentTokens` and `compaction.summaryMaxTokens` for models that need a different tradeoff.

## Timeline

- time: "2026-08-12T03:46:47.651Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T03:46:47.651Z"
  kind: "evidence"
  summary: "User approved this policy on 2026-08-11 after observing a Muse Glimmer 30B chat compact from about 100K tokens to only about 80K. Implemented in packages/server/src/server/agent/provider-registry.ts and packages/server/src/server/agent/providers/openai-compat-agent.ts; verified by targeted Vitest, server build/typecheck, and targeted lint."
