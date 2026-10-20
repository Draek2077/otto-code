---
id: "user-mode-explorer-retains-files-and-search"
kind: "requirement"
title: "User mode Explorer retains Files and Search"
status: "confirmed"
tags: ["explorer","search","user-mode","interface-mode"]
created_at: "2026-09-08T03:03:50.685Z"
updated_at: "2026-09-08T03:03:50.685Z"
---
# User mode Explorer retains Files and Search

<!-- compiled_truth -->

User mode keeps the Files and Otto Search Explorer views whenever the connected host advertises project-search support. Changes and pull-request views remain Developer-mode Git surfaces.

## Timeline

- time: "2026-09-08T03:03:50.685Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["explorer-sidebar-convergence-on-upstream-s-pane-host-system"]
- time: "2026-09-08T03:03:50.685Z"
  kind: "evidence"
  summary: "User direction on 2026-09-07: the Files sidebar search option had been removed and must be restored. Verified implementation restores the tab, launcher, compact Explorer, and sidebar.open.search shortcut while retaining the Changes and pull-request gates."
