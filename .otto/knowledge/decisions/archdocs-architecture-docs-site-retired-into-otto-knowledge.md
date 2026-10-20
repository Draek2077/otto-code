---
id: "archdocs-architecture-docs-site-retired-into-otto-knowledge"
kind: "decision"
title: "archdocs architecture-docs site retired into Otto Knowledge"
status: "confirmed"
tags: ["archdocs-retirement", "documentation", "knowledge", "migration"]
created_at: "2026-08-16T13:54:57.138Z"
updated_at: "2026-08-16T13:58:53.501Z"
---

# archdocs architecture-docs site retired into Otto Knowledge

<!-- compiled_truth -->

The `archdocs/` directory (AsciiDoc + Mermaid architecture-docs site: `pages/*.adoc`, `build.mjs`, `serve.mjs`, `templates/`, `theme.css`, port 4400) was retired on 2026-08-16. Its genuinely-unique content was folded into Otto Knowledge (`.otto/knowledge/`) and `docs/`; the redundant pages were retired as `docs/` is the deeper source. Every `archdocs/` pointer in the live tree was rewritten. The build/serve toolchain, the `archdocs:build`/`archdocs:serve` package.json scripts, and the `archdocs` `.claude/launch.json` entry were removed.

The directory held 17 `.adoc` pages (`00`-`06` and `10`-`19`; the brief's "18" was a miscount). Disposition:

- `00-index.adoc` — meta master-TOC for the retired site. Retired with the site; its subsystem map is covered by `docs/README.md` and the architecture Knowledge root.
- `01-system-overview.adoc` — INCORPORATED: covered by `docs/architecture.md` (context diagram, package layering, agent lifecycle, data flow) and the Otto Knowledge architecture root. archdocs was a summary; `docs/` is deeper.
- `02-module-map.adoc` — the package-layering/system-map half is covered by `docs/architecture.md`; the oversized-module inventory is the unique part → recorded as the Knowledge finding `oversized-module-inventory-the-standing-refactor-backlog` (re-measured 2026-08-16).
- `03-configuration.adoc` — INCORPORATED into a new `docs/configuration.md` (the five config layers, the two-flag distinction, and the full `OTTO_*` environment variable reference, which had no home in `docs/`). Indexed in `docs/README.md`.
- `04-diagram-catalog.adoc` — NOT DONE (retired with the site). It was a curation instrument for the archdocs set itself: each entry states why a specific diagram earns its place in that set. With the set gone, the per-diagram rationale has no live home and does not map to a `docs/` page or a Knowledge record. To do it, one would need to re-derive which of the proposed diagrams (D8 permission flow, D9 provider adapter contract, D11 chat render pipeline, D13 workspace/git ERD, D14 release pipeline) still deserve diagrams and add them to a live home (a `docs/` page or a Knowledge architecture record) with their own rationale.
- `05-audit-architecture.adoc` — INCORPORATED (retired as redundant): `docs/subagent-accounting.md` (adapter guide, pricing invariant, de-inflation) and `docs/activity-stats.md` (counter store, usage ledger, retention, RPCs, invariants) are deeper and cover all ten audit invariants and the measurement model.
- `06-engineering-guide.adoc` — split. §1 chat-sync and §3 UI-performance invariants (the four cursor outcomes, the state-topology single-writer rule, the React Query replica, the 48 ms batching) are NOT in any `docs/` page → recorded as the Knowledge record `client-state-topology-and-chat-sync-invariants`. §2 usage-audit overlaps `05` (retired, covered by the audit docs); §4 IDE tooling overlaps `docs/preview.md` + `docs/orchestration-node-capabilities.md` (retired as redundant).
- `10`-`19` orchestration set — all INCORPORATED into Otto Knowledge (the genuinely-unique, code-reconciled set): `orchestration-domain-model-and-engine-invariants` (10+11+12 shape/concepts/invariants), `orchestration-phase-run-engine` (13), `orchestration-graph-engine-execution-model` (14), `orchestration-agent-binding-and-provider-coverage` (16), `orchestration-durability-designed-resume-model` (15), `orchestration-designer-and-authoring-surface-design` (17), `orchestration-observability-and-accounting-design` (18), `orchestration-rollout-testing-and-invariants-design` (19). The "Decided, not built" design notes from page 12 are the five `proposed` records: `runs-become-a-preset-graph-template`, `ports-and-conditions-are-not-competitors`, `orchestration-run-values-use-opt-in-scopes`, `orchestration-per-node-accounting-is-a-precondition`, `orchestration-grading-has-more-than-one-mechanism`.

The `.adoc` preview test corpus (the 17 pages) was moved verbatim to `test-documents/archdocs-corpus/` and the two `.adoc` preview tests (`asciidoc-to-markdown.test.ts`, `file-pane-render-mode.test.ts`) were repointed there — the converter behaviour was not changed (out of scope).

## Timeline

- time: "2026-08-16T13:54:57.138Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants","client-state-topology-and-chat-sync-invariants","oversized-module-inventory-the-standing-refactor-backlog"]
- time: "2026-08-16T13:54:57.138Z"
  kind: "evidence"
  summary: "Executed 2026-08-16. `archdocs/` deleted; `npm run archdocs:build`/`archdocs:serve` and the launch.json entry removed; the 18 pages moved to `test-documents/archdocs-corpus/` (73/73 tests pass in the two affected test files); `docs/configuration.md` created and indexed; 13 new/updated Knowledge records created. `lint_project_knowledge_links` reports no broken links; a tracked-files audit confirms no live broken `archdocs/` path reference remains (the only remaining mentions are the `archdocs-retirement` provenance tags, the append-only Knowledge timeline history, and the separate `.claude/worktrees/win-ci-diag` worktree, which is out of scope)."
- time: "2026-08-16T13:57:19.949Z"
  kind: "decision"
  summary: "Correcting a self-contradictory page count: the on-disk corpus is 17 .adoc files (00-06 and 10-19); the brief's \"18\" was a miscount."
- time: "2026-08-16T13:58:53.501Z"
  kind: "evidence"
  summary: "NOT-DONE items (content left behind with a written reason, not a guess):\n\n1. `04-diagram-catalog.adoc` — curation instrument for the archdocs diagram set itself. Each entry states why a specific diagram earns its place in that set. With the set deleted, the per-diagram rationale has no live home in `docs/` or Knowledge. To incorporate: re-derive which proposed diagrams (D8 permission flow, D9 provider adapter contract, D11 chat render pipeline, D13 workspace/git ERD, D14 release pipeline) still deserve diagrams and add them to a live home with their own rationale.\n\n2. `06-engineering-guide.adoc` §5 \"Extending this set\" (the meta three-block pattern: every subsystem doc ends with drawn system / invariants / checklist) — this was a convention of the retired `archdocs/templates/` set. It was never a project-wide documentation convention in `docs/` or Knowledge. No live home for a doc-template convention from a now-deleted template directory.\n\nAll other content from all 17 pages is INCORPORATED (either into a new/updated `docs/` page, into an existing `docs/` page that already owned the topic, or into Otto Knowledge records).\n\nRewritten pointers (every file that referenced `archdocs/` in a live pointer, now updated):\n- `docs/orchestration-node-capabilities.md` — pointer to archdocs pages 10-19 → Otto Knowledge records\n- `docs/README.md` (2 spots) — two archdocs rows → Otto Knowledge references\n- `docs/development.md` (2 spots) — removed archdocs:4400 from port list and endpoint list\n- `AGENTS.md` — repo-map row for archdocs → Otto Knowledge\n- `README.md` — five-trees table: archdocs row → Otto Knowledge row\n- `projects/README.md` (3 spots) — graph-templates row, \"Engine-side decisions live in...\" paragraph, grep instruction\n- `.otto/knowledge/projects/graph-templates.md` — pointer fixed\n- `projects/graph-templates/graph-templates.md` — legacy source, pointer fixed\n- `.otto/knowledge/projects/marketing-strategy.md` — \"four-tree documentation system\" → \"documentation system\"\n- `projects/marketing-strategy/feature-inventory.md` — same change\n- `docs/references.md` (2 spots) — Mermaid and AsciiDoc rows updated\n- `docs/writing-style.md` — \"archdocs/\" → \"Otto Knowledge\"\n- `.otto/knowledge/references/reference-mermaid.md` — updated via tool\n- `packages/app/e2e/global-setup.ts` — removed 4400 from RESERVED_LOCAL_PORTS\n- `packages/website/vite.config.ts` — removed \"beside archdocs on 4400\" from comment\n- `test-documents/README.md` — added row for `archdocs-corpus/`"
  source: "retirement execution log, 2026-08-16"
