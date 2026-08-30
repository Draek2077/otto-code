---
id: "ai-workflow-planning-record-lives-with-its-chat"
kind: "requirement"
title: "An AI Workflow stays in Planning while its orchestrator chat is alive"
status: "confirmed"
tags: ["workflows","orchestration","lifecycle"]
created_at: "2026-08-30T00:46:17.213Z"
updated_at: "2026-08-30T00:46:17.213Z"
---
# An AI Workflow stays in Planning while its orchestrator chat is alive

<!-- compiled_truth -->

The daemon persists an AI Workflow as a pending ("Planning") record before the orchestrator's first turn and binds it to that chat. The record must stay pending for as long as the chat exists, so an orchestrator that asks a clarifying question on its first turn can still declare its plan with `start_workflow` on a later turn. It becomes a durable failed record only when the chat is archived or deleted without a declared plan (daemon agent-archived hook), when the user cancels it, or when the daemon restarts mid-planning. Turn settlement is never a failure signal.

## Timeline

- time: "2026-08-30T00:46:17.213Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows"]
- time: "2026-08-30T00:46:17.213Z"
  kind: "evidence"
  summary: "Decided 2026-08-29. The earlier implementation failed the record when the first turn settled, which broke any model that asks before planning (common with local models) and made a later `start_workflow` call error with \"not a pending AI Workflow\". Code: packages/server/src/server/orchestration/user-orchestration.ts (startAiOrchestration), run-service.ts (failPendingAiRunForConductor, restartRecoveryReason), bootstrap.ts (setAgentArchivedCallback). Docs: docs/workflows.md \"Starting a Workflow\". Proven by run-orchestration.integration.test.ts \"persists an AI Workflow before its real planning chat settles\" and run-service.test.ts."
