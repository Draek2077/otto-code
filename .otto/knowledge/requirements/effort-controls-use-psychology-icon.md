---
id: "effort-controls-use-psychology-icon"
kind: "requirement"
title: "Effort controls use the Psychology head-and-gear icon"
status: "confirmed"
tags: ["ui","icons","agent-controls","otto-brain"]
created_at: "2026-08-21T22:03:52.125Z"
updated_at: "2026-08-21T22:03:52.125Z"
---
# Effort controls use the Psychology head-and-gear icon

<!-- compiled_truth -->

Effort, reasoning, and thinking controls use the Material Symbols `Psychology` icon: a man's head with a gear inside. The Lucide `Brain` icon remains reserved for Otto Brain surfaces so the two concepts remain visually distinct.

## Timeline

- time: "2026-08-21T22:03:52.125Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:03:52.125Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21. Verified implementation in `packages/app/src/components/icons/material-icons.ts` (the existing Psychology icon comment) and `packages/app/src/agent-controls/icons.ts`, where `ThinkingIcon` now resolves to `Psychology`."
