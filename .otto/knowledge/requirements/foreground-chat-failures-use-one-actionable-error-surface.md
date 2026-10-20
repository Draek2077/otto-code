---
id: "foreground-chat-failures-use-one-actionable-error-surface"
kind: "requirement"
title: "Foreground chat failures use one actionable error surface"
status: "proposed"
tags: ["chat","errors","brain","remote","ux"]
created_at: "2026-08-21T02:27:40.391Z"
updated_at: "2026-08-21T02:31:57.384Z"
---
# Foreground chat failures use one actionable error surface

<!-- compiled_truth -->

When a foreground chat turn fails, Otto shows the failure through the composer error surface and does not persist a duplicate `[System Error]` assistant message in the transcript. A transport outage from any OpenAI-compatible provider uses the concise, neutral message: “Provider is unavailable. Check that it is running and that the settings are correct.”

## Timeline

- time: "2026-08-21T02:27:40.391Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["remote-brain-functionality-is-host-owned-and-connection-neutral"]
- time: "2026-08-21T02:27:40.391Z"
  kind: "evidence"
  summary: "User report and screenshot on 2026-08-20 showed one remote Otto Brain outage rendered twice: raw `fetch failed` in the red composer error and `[System Error] fetch failed` as an assistant bubble. Implemented in `packages/server/src/server/agent/agent-manager.ts` and `packages/server/src/server/agent/providers/openai-compat-agent.ts`, with focused tests."
- time: "2026-08-21T02:31:57.384Z"
  kind: "decision"
  summary: "User clarified that the recovery message must apply to every OpenAI-compatible provider, not only Otto Brain, and supplied the final neutral wording."
  affects: ["remote-brain-functionality-is-host-owned-and-connection-neutral"]
