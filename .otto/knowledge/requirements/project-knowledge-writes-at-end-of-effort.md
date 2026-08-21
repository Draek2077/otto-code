---
id: "project-knowledge-writes-at-end-of-effort"
kind: "requirement"
title: "Project Knowledge writes at the end of an effort"
status: "confirmed"
tags: ["project-knowledge","agent-workflow","knowledge-capture","provenance"]
created_at: "2026-08-21T16:11:40.425Z"
updated_at: "2026-08-21T16:11:40.425Z"
---
# Project Knowledge writes at the end of an effort

<!-- compiled_truth -->

Agents read relevant Project Knowledge at the start of work, but defer proactive writes while an effort is still being explored or implemented. After the requested outcome is verified and before the final handoff, the agent performs one reconciliation pass: review relevant active and proposed pages, update the best existing record instead of creating overlap, and record only stable, evidence-backed outcomes that will matter beyond the current task. Queries, hypotheses, trial-and-error, attempted fixes, abandoned approaches, transient implementation details, and ordinary dead ends are not Project Knowledge. A failed experiment is recorded only when the failure itself is a verified, reusable finding. If the effort establishes nothing durable, the reconciliation produces no write. Direct Project Knowledge creation, ingestion, and review tasks may write as part of that requested workflow.

## Timeline

- time: "2026-08-21T16:11:40.425Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","findings-capture-unresolved-observations-before-decisions"]
- time: "2026-08-21T16:11:40.425Z"
  kind: "evidence"
  summary: "Explicit user direction on 2026-08-21. Implemented in the injected catalog and generated `.otto/KNOWLEDGE.md` contract in `packages/server/src/server/agent/project-knowledge/project-knowledge-service.ts`, the Project Knowledge tool descriptions in `packages/server/src/server/agent/tools/otto-tools.ts`, `skills/otto-project-knowledge/SKILL.md`, `AGENTS.md`, and `docs/project-knowledge.md`. Verified by the focused ProjectKnowledgeService test, targeted lint, and repository typecheck."
