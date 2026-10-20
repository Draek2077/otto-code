---
id: "workspace-diff-stat-renders-per-workspace-not-project"
kind: "requirement"
title: "Workspace diff stats render per workspace, not project"
status: "confirmed"
tags: ["workspace", "git", "sidebar", "ui"]
created_at: "2026-08-11T04:31:14.320Z"
updated_at: "2026-08-11T04:31:14.320Z"
---

# Workspace diff stats render per workspace, not project

<!-- compiled_truth -->

The sidebar +/- indicator renders on each individual workspace row. Project rows never aggregate workspace diff stats because a project is a grouping, not a Git checkout or a single comparison base. Otto's developer preference selects whether each workspace row displays the uncommitted working tree, the branch-versus-base diff, or no diff stat.

## Timeline

- time: "2026-08-11T04:31:14.320Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T04:31:14.320Z"
  kind: "evidence"
  summary: "User direction on 2026-08-10: restore Paseo's per-workspace placement while retaining Otto's choice of diff-stat semantics."
