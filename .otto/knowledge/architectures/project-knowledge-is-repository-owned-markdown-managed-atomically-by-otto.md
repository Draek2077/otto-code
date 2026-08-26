---
id: "project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"
kind: "architecture"
title: "Project knowledge is repository-owned Markdown managed atomically by Otto"
status: "confirmed"
tags: ["architecture","project-knowledge","workflow","provenance"]
created_at: "2026-08-08T03:27:34.679Z"
updated_at: "2026-08-26T02:44:55.580Z"
---
# Project knowledge is repository-owned Markdown managed atomically by Otto

<!-- compiled_truth -->

Otto keeps shared project memory as Otto-owned rich Markdown, in one layout that lives in one of two places.

- **Repository**, at `.otto/knowledge` in the working tree. Versioned, shared, reviewable in a pull request. This is the default.
- **Host**, at `$OTTO_HOME/project-knowledge/<project>/`, so nothing appears in the working tree and no repository has to gitignore anything. Not versioned, not shared.

The effective location resolves in a fixed order: a project's own override, then a repository store that already exists on disk, then the host default. The middle rule is what makes changing the host default safe, since a checked-in `.otto/knowledge` always keeps working. See [[configurable-project-knowledge-store-location]].

Everything below is identical in both locations.

- Every new or resumed chat receives a compact catalog of the six roots and **confirmed pages only**; full page bodies are read on demand.
- The fixed roots are `background`, `architecture`, `flow`, `mindmap`, `stack`, and `roadmap`.
- Atomic pages use human-readable slugs and double-bracket wiki links to other atomic page ids, with `proposed`, `confirmed`, and `superseded` lifecycle states.
- Current truth is rewritable only together with a reason; evidence, decisions, reversals, notes, and migrations remain in an uncapped append-only timeline.
- The daemon owns reads and mutations so every provider gets the same behavior, worktrees resolve to one project store, and the store location is decided in one place rather than inferred by each caller.

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
- time: "2026-08-26T02:44:55.580Z"
  kind: "decision"
  summary: "Repository ownership stopped being the whole truth: a project's Knowledge store can now be host-local under `$OTTO_HOME/project-knowledge/<project>/` instead of `.otto/` in the working tree, so a repository never has to gitignore anything to use Knowledge. Everything else on this page is unchanged, and the repository location remains the default. Recorded while building the store-location feature (see the `configurable-project-knowledge-store-location` project page) at the user's direction."
  source: "packages/server/src/server/agent/project-knowledge/project-knowledge-store-resolver.ts; docs/project-knowledge.md \"Where the store lives\""
  affects: ["packages-server-src-server-agent-project-knowledge","docs-project-knowledge-md"]
