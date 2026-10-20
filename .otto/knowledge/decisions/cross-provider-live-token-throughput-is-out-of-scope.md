---
id: "cross-provider-live-token-throughput-is-out-of-scope"
kind: "decision"
title: "Cross-provider live token throughput is out of scope"
status: "confirmed"
tags: ["providers","metrics","token-accounting","performance","scope"]
created_at: "2026-08-21T15:29:25.570Z"
updated_at: "2026-08-21T15:29:25.570Z"
---
# Cross-provider live token throughput is out of scope

<!-- compiled_truth -->

# Decision

Otto will not build a chat-facing, provider-neutral feature for live input or output tokens per second. The feature is out of scope because Otto cannot obtain the underlying per-request token counts and model timings easily, accurately, and live across every supported provider. Estimated values, turn-duration division, and provider-specific partial coverage do not meet Otto's provider-parity or honesty standard.

Otto Brain's existing host-level slot telemetry is not removed or generalized by this decision. Brain already owns its llama.cpp runtime and publishes bounded-rate prefill/decode slot metrics to the Brain Overview. Those operational host metrics remain separate from chat query accounting; Otto will not attribute a live slot to a specific chat or add TPS to the chat stream without a new explicit decision.

See [[finding-cross-provider-token-throughput-observability]].

## Timeline

- time: "2026-08-21T15:29:25.570Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["finding-cross-provider-token-throughput-observability","provider-neutral-capability-parity-defines-done"]
- time: "2026-08-21T15:29:25.570Z"
  kind: "evidence"
  summary: "User decision on 2026-08-21: \"this is a no go feature, if we cannot get the info easily and accurately and live during the query.\" Code verification the same day found that Otto Brain already samples slot counters once per second while busy in `packages/brain/src/service/status-events.ts`, transmits coalesced complete snapshots through `brain_status_changed`, and renders per-slot prompt/decode rates in `packages/app/src/screens/brain/overview-tab.tsx`. The public slot shape has no chat/agent identity."
