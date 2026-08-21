---
id: "project-knowledge-policy-is-pull-on-demand"
kind: "requirement"
title: "Project Knowledge policy is pull-on-demand"
status: "confirmed"
tags: ["project-knowledge","token-economy","context-management","progressive-disclosure"]
created_at: "2026-08-21T16:25:37.228Z"
updated_at: "2026-08-21T16:38:09.520Z"
---
# Project Knowledge policy is pull-on-demand

<!-- compiled_truth -->

Otto must not inject full Project Knowledge pages or a repository policy document into every chat. The compact session catalog carries Otto's baked-in default capture behavior, root/page discovery, and no full bodies. `.otto/KNOWLEDGE.md` is optional project-specific supplemental or overriding guidance, not an initialization requirement; when it contains custom guidance the catalog adds only a short pointer and agents read the body on demand before writing or managing Knowledge. `.otto/knowledge/index.md` identifies an initialized store, so Knowledge continues to work when the optional file is absent. Existing generated entry files remain recognized during a compatibility window without being treated as custom guidance.

## Timeline

- time: "2026-08-21T16:25:37.228Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["project-knowledge-writes-at-end-of-effort","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"]
- time: "2026-08-21T16:25:37.228Z"
  kind: "evidence"
  summary: "Explicit user direction on 2026-08-21 that Otto must make deliberate context choices because its injected prompts, tool schemas, and MCP surface are already costly, and that information should sometimes remain available rather than always injected. Implemented in `ProjectKnowledgeService`, the bundled Project Knowledge skills, `.otto/KNOWLEDGE.md`, and `docs/project-knowledge.md`; verified by focused tests proving customized policy is preserved but absent from the injected brief."
- time: "2026-08-21T16:38:09.520Z"
  kind: "decision"
  summary: "The user clarified that Otto's known-good behavior should be baked in and that a repository Markdown file may supplement or override it but must not be required. This supersedes the earlier assumption that initialization should install a governing default policy document."
  source: "Explicit user direction on 2026-08-21; verified implementation and focused tests."
  affects: ["project-knowledge-writes-at-end-of-effort","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"]
