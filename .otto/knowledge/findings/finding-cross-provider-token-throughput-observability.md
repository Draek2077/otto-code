---
id: "finding-cross-provider-token-throughput-observability"
kind: "finding"
title: "Cross-provider token throughput is not universally observable"
status: "confirmed"
tags: ["providers","metrics","token-accounting","performance"]
created_at: "2026-08-21T15:23:51.608Z"
updated_at: "2026-08-21T15:29:20.753Z"
---
# Cross-provider token throughput is not universally observable

<!-- compiled_truth -->

# Finding

Otto can normalize provider-reported token counts across most provider adapters, but the current provider-neutral contract cannot produce accurate per-request input and output token throughput for every provider.

`AgentUsage` carries token and cost leaves but no request timing or measurement provenance. The durable usage ledger records turn-level or generation-level aggregates at completion, and a turn can contain multiple model round-trips, tool execution, permission waits, retries, and compaction. Dividing those token totals by the rendered turn duration would therefore measure end-to-end agent workflow speed, not model prefill or decode throughput.

Only runtimes that expose server-side timings or counters can supply true prefill/decode rates. Otto Brain's llama.cpp integration already measures per-slot prompt and decode counters and can also read llama.cpp response timings. Other direct or CLI-backed providers can at best provide daemon-observed request, first-stream-event, last-stream-event, and completion times when their adapter sees each model request; those measurements include network, queueing, process/IPC buffering, and sometimes hidden reasoning. ACP usage is optional, so some ACP providers cannot supply even the token-count half.

A provider-neutral throughput feature must preserve one sample per model request and label provenance explicitly, for example `server_reported`, `daemon_observed`, or `unavailable`. It should expose TTFT and end-to-end latency separately. It must not label `inputTokens / (first event - request start)` as prefill TPS, and must not derive decode TPS from turn-level wall time.

## Timeline

- time: "2026-08-21T15:23:51.608Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-capability-parity-defines-done"]
- time: "2026-08-21T15:23:51.608Z"
  kind: "evidence"
  summary: "Code audit on 2026-08-21: `packages/server/src/server/agent/agent-sdk-types.ts` and `packages/protocol/src/agent-types.ts` define `AgentUsage` without timing; `packages/server/src/server/activity-stats/usage-log-store.ts` persists counts/cost but no request duration; `packages/app/src/timeline/turn-time.ts` derives duration from user-message to last timeline item; `packages/server/src/server/agent/providers/openai-compat-agent.ts` accumulates usage over multiple model rounds; `packages/server/src/server/agent/providers/codex-app-server-agent.ts` likewise accumulates request usage; `packages/server/src/server/agent/providers/acp-agent.ts` maps optional ACP usage; `packages/brain/src/sysmon.ts` measures llama.cpp per-slot prompt/decode counter rates, and `packages/brain/src/bench/tasks.ts` reads llama.cpp server-reported timings."
- time: "2026-08-21T15:29:20.753Z"
  kind: "note"
  summary: "User explicitly accepted the finding on 2026-08-21 and rejected a cross-provider live token-throughput feature because the data cannot be obtained easily, accurately, and live for every provider. New status: confirmed."
