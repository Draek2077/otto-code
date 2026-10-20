---
id: "product-knowledge-status-filters-prioritize-confirmed-current-knowledge"
kind: "requirement"
title: "Product Knowledge status filters prioritize confirmed current knowledge"
status: "proposed"
tags: ["project-knowledge","ui","filters","review-status","accessibility"]
created_at: "2026-09-06T14:56:22.392Z"
updated_at: "2026-09-06T14:59:40.849Z"
---
# Product Knowledge status filters prioritize confirmed current knowledge

<!-- compiled_truth -->

Product Knowledge opens and resets to the **Confirmed** lifecycle filter, because confirmed records are the knowledge Otto uses and references. The status control retains **All** for review rather than making a removal decision implicitly. In that combined view, **Proposed** records use the theme’s amber warning color and **History** records use the subdued foreground typography color, making their non-current state apparent without hiding them. The stored lifecycle values and existing UI labels remain unchanged. Its icon-only status segments preserve those names in accessible labels and desktop tooltips.

## Timeline

- time: "2026-09-06T14:56:22.392Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["knowledge-unconfirmed-status-is-draft","manage-knowledge-status-filters-use-icon-only-segments","knowledge-list-uses-typed-icons-and-explicit-selection"]
- time: "2026-09-06T14:56:22.392Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-09-06. Implemented in `packages/app/src/project-knowledge/panel.tsx` and `model.ts`; focused model test and targeted lint passed."
- time: "2026-09-06T14:57:42.051Z"
  kind: "evidence"
  summary: "Focused `packages/app/src/project-knowledge/model.test.ts` passed (8 tests); targeted lint, app typecheck, formatting, and `git diff --check` passed. The shared icon-segment renderer was corrected to render its FunctionComponent through JSX, preserving the concurrent icon-only filter behavior while satisfying TypeScript."
  source: "Implementation verification, 2026-09-06"
- time: "2026-09-06T14:59:40.849Z"
  kind: "decision"
  summary: "User correction, 2026-09-06: do not rename lifecycle labels. Status returned to proposed for review."
  source: "Explicit user direction, 2026-09-06"
