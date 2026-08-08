---
id: "project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"
kind: "architecture"
title: "Project knowledge is repository-owned Markdown managed atomically by Otto"
status: "confirmed"
tags: ["architecture", "project-knowledge", "workflow", "provenance"]
created_at: "2026-08-08T03:27:34.679Z"
updated_at: "2026-08-08T05:17:27.860Z"
---

# Project knowledge is repository-owned Markdown managed atomically by Otto

<!-- compiled_truth -->

Otto keeps shared project memory as repository-owned rich Markdown under `.otto/knowledge`.

- Every new or resumed chat receives a compact catalog of the six roots and **confirmed pages only**; full page bodies are read on demand.
- The fixed roots are `background`, `architecture`, `flow`, `mindmap`, `stack`, and `roadmap`.
- Atomic pages use human-readable slugs and double-bracket wiki links to other atomic page ids, with `proposed`, `confirmed`, and `superseded` lifecycle states.
- Current truth is rewritable only together with a reason; evidence, decisions, reversals, notes, and migrations remain in an uncapped append-only timeline.
- The daemon owns reads and mutations so every provider gets the same behavior and worktrees resolve to one project store.

This deliberately mirrors Brain.md's behavioral model while retaining Otto's own taxonomy, status names, workspace resolution, tools, and RPCs. It is not a byte-for-byte or CLI-compatible Brain.md store.

## Timeline

- time: "2026-08-08T03:27:34.679Z"
  kind: "created"
  summary: "Knowledge page created."
- time: "2026-08-08T05:06:24.112Z"
  kind: "evidence"
  summary: "docs/project-knowledge.md defines the .otto storage layout, lifecycle statuses, retrieval model, daemon-owned tools, and atomic update invariant. The bootstrapped .otto/KNOWLEDGE.md instructs agents to use Otto project-knowledge tools, and .otto/knowledge/index.md contains the existing confirmed Test record."
  source: "Legacy Markdown evidence section"
- time: "2026-08-08T05:06:24.112Z"
  kind: "migration"
  summary: "Migrated from legacy page id a71c0493-01bc-4bcf-ab3b-c86408eedf86 to project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto."
- time: "2026-08-08T05:14:18.311Z"
  kind: "migration"
  summary: "Migrated to the canonical rich Markdown page format."
- time: "2026-08-08T05:16:38.340Z"
  kind: "decision"
  summary: "The user approved completing the Brain.md parity work, including active-only discovery, six rich roots, human slugs, wiki links, daemon-owned writes, and an append-only timeline."
  source: "User direction in the project-knowledge evaluation conversation; docs/project-knowledge.md"
- time: "2026-08-08T05:16:38.546Z"
  kind: "note"
  summary: "The product owner explicitly approved this storage and lifecycle design while directing the Brain.md parity completion. New status: confirmed."
- time: "2026-08-08T05:17:27.860Z"
  kind: "decision"
  summary: "Removed a literal pseudo-link from compiled truth after link lint correctly treated it as a nonexistent page target."
  source: "lint_project_knowledge_links onboarding verification"
