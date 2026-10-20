---
id: "files-tab-restores-persisted-expansion-from-listings-never-from-memory-alone"
kind: "architecture"
title: "Files tab restores persisted expansion from listings, never from memory alone"
status: "proposed"
tags: ["file-explorer","app","bug-fix"]
created_at: "2026-08-20T06:33:48.059Z"
updated_at: "2026-08-20T06:33:48.059Z"
---
# Files tab restores persisted expansion from listings, never from memory alone

<!-- compiled_truth -->

The Files tab restores remembered folder expansion by walking the listings it already holds, one level at a time: a persisted path is listed only once its parent listing is in hand and still names it as a directory, and a path its loaded parent no longer names is forgotten (along with everything under it). Background listings - persisted-expansion restore and subtree refresh - never write the pane-wide error; only a listing the user asked for can do that.

## Timeline

- time: "2026-08-20T06:33:48.059Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["archdocs-architecture-docs-site-retired-into-otto-knowledge"]
- time: "2026-08-20T06:33:48.059Z"
  kind: "evidence"
  summary: "Reported 2026-08-20: the Files tab rendered a full-pane \"ENOENT: no such file or directory, stat 'C:\\Users\\phili\\Projects\\otto-code\\archdocs'\" with a Retry button, on every visit, for a folder retired months earlier (see archdocs-architecture-docs-site-retired-into-otto-knowledge).\n\nCause: `requestPersistedExpandedPaths` in `packages/app/src/components/file-explorer-pane.tsx` replayed every path in `panel-store.expandedPathsByWorkspace` the moment the root listing landed, with no existence check, and `useFileExplorerActions.requestDirectoryListing` wrote any failure to the single pane-wide `lastError`. Because the stale path stayed persisted, the error came back forever.\n\nAn earlier fix - upstream Paseo #2595, which added `restoreExpandedDirectories` / `reconcileRestoredExpandedPaths` in `packages/app/src/file-explorer/tree.ts` - never took effect in this fork: the module is imported only by its own test, and the pane kept its own blind replay. Grep for `file-explorer/tree` to confirm before assuming that module is live.\n\nFix: `packages/app/src/file-explorer/expanded-paths.ts` (`planExpandedPathSync`, unit-tested) computes request/prune from the loaded listings; the pane runs it as an effect keyed on the listings, so it cascades as each level arrives. `requestDirectoryListing` gained `surfaceErrors`, which restore and subtree refresh pass as `false`. Refresh re-fetches only paths it actually holds a listing for."
