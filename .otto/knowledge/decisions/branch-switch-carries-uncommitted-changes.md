---
id: "branch-switch-carries-uncommitted-changes"
kind: "decision"
title: "Branch switching carries uncommitted changes"
status: "confirmed"
tags: ["git", "branch-switching", "workspace"]
created_at: "2026-08-12T22:08:56.698Z"
updated_at: "2026-08-12T22:08:56.698Z"
---

# Branch switching carries uncommitted changes

<!-- compiled_truth -->

Otto does not add a separate Unstaged-files view to work around agent force-staging. When Git blocks a branch switch because of uncommitted changes, the branch switcher offers Stash, Switch & Pop: it creates an Otto stash including untracked files, switches branches, then immediately pops that same stash onto the destination. If the pop conflicts, Git retains the stash so the changes remain recoverable.

## Timeline

- time: "2026-08-12T22:08:56.698Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["changes-view"]
- time: "2026-08-12T22:08:56.698Z"
  kind: "evidence"
  summary: "User direction on 2026-08-12: prefer “Stash & Switch & Pop” over an Unstaged view because the work should travel to the destination branch."
