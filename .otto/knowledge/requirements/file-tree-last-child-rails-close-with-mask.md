---
id: "file-tree-last-child-rails-close-with-mask"
kind: "requirement"
title: "File tree rails close at the final visible child"
status: "proposed"
tags: ["ui","sidebar","file-explorer","tree-view","tree-rails"]
created_at: "2026-08-21T23:05:49.214Z"
updated_at: "2026-08-21T23:23:51.313Z"
---
# File tree rails close at the final visible child

<!-- compiled_truth -->

The Files tree must stop each ancestor rail at the final visible sibling and render a closing connector rather than a hanging full-height branch. The flattened Files rows carry a compact ancestor rail mask, and create/rename rows preserve the same mask behavior. Shared tree geometry distinguishes the centered vertical rail from the horizontal child connector: rails align with the disclosure slot center, while connectors stop at the child slot's leading edge so they do not overlap the child chevron. Changes and Solution trees continue to use the shared tree-rail primitive.

## Timeline

- time: "2026-08-21T23:05:49.214Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T23:05:49.214Z"
  kind: "evidence"
  summary: "User direction, 2026-08-21, referencing the established sidebar Files/tree-view treatment. Verified implementation in `packages/app/src/file-explorer/tree.ts` and `packages/app/src/components/file-explorer-pane.tsx`; regression coverage in `packages/app/src/file-explorer/tree.test.ts` confirms an intermediate child keeps the rail and the final child closes it. App typecheck, targeted lint, formatting, and the focused tree test pass."
- time: "2026-08-21T23:15:06.575Z"
  kind: "evidence"
  summary: "Geometry refinement verified on 2026-08-21: the shared tree rail is centered on the 16px disclosure slot (`TREE_ICON_CENTER_OFFSET = 8`), and each horizontal connector spans one `TREE_INDENT_PER_LEVEL` step so it reaches the child chevron center. Focused tree-rail and file-explorer tests (16 cases), app typecheck, targeted lint, and formatting pass."
  source: "packages/app/src/components/tree-primitives.tsx"
  affects: ["file-tree-last-child-rails-close-with-mask"]
- time: "2026-08-21T23:23:51.313Z"
  kind: "decision"
  summary: "User clarification on 2026-08-21: centering the root disclosure widgets with their vertical rails was correct, but applying the same endpoint to child connectors made the branch overlap the child chevron. The shared geometry now keeps centered rails and uses a half-step connector."
  source: "User clarification and implementation in packages/app/src/components/tree-primitives.tsx; focused tree-rail/file-explorer tests, app typecheck, targeted lint, a"
  affects: ["file-tree-last-child-rails-close-with-mask"]
