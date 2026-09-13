---
id: "user-mode-preserves-capabilities-and-simplifies-workflows"
kind: "requirement"
title: "User mode preserves useful tools and presents Git as backups"
status: "proposed"
tags: ["user-mode","interface-mode","workspace","files","backups","upstream"]
created_at: "2026-09-13T00:19:18.505Z"
updated_at: "2026-09-13T01:06:40.692Z"
---
# User mode preserves useful tools and presents Git as backups

<!-- compiled_truth -->

User mode helps people accomplish tasks without requiring them to understand development workflows. It preserves the full File Editor when a file is opened, all open content tabs, script output, workspace Scripts and Open tools, and pane split/maximize/restore controls wherever supported. It simplifies entry points and explanations rather than hiding useful capabilities.

Git is presented as file backups: save a local version, check for newer remote versions, download updates, upload saved versions, and inspect version history. Local version saving and remote backup upload remain distinct outcomes. The ordinary backup workflow uses main/master. Switching interface mode does not silently switch branches, move files, or upload anything; existing advanced workspaces remain accessible.

New Workspace keeps its full Git setup in User mode: the branch and PR picker, the local or worktree isolation choice, and the create-worktree option when a directory is already occupied. Workspace creation is the easiest way to start Git work, so basic backup tools never replace it. Inside an open workspace, the branch switcher, branch and PR meta, copy-branch-name, and pull request actions stay out of User mode.

Preserve Paseo mergeability through Otto-owned presentation modules and small composition-site changes. Keep the existing Git execution, authentication, editor, layout persistence, and protocol owners. Follow [[upstream-mergeability-through-otto-owned-seams]]. Files and Search continue to follow [[user-mode-explorer-retains-files-and-search]].

## Timeline

- time: "2026-09-13T00:19:18.505Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["user-mode","user-mode-explorer-retains-files-and-search","upstream-mergeability-through-otto-owned-seams"]
- time: "2026-09-13T00:19:18.505Z"
  kind: "evidence"
  summary: "Explicit user direction in this chat on 2026-09-12: restore File Editor, workspace layouts, Scripts/Open/Git tools; simplify Git as a backup system; users should accomplish tasks naturally without thinking about code; keep Otto/Paseo safe and merge friendly. Source changes are concentrated in Otto backup policy/copy/UI modules and UI gates. Focused policy, tab, layout, keyboard, compact-header and occupied-directory tests pass. Current implementation uses existing Git projects and configured remotes, with ten recent versions; it does not add initial backup provisioning. Browser validation remains unverified because the running Metro preview cannot resolve @otto-code/protocol/binary-frames/index even after rebuilding the client packages."
- time: "2026-09-13T01:06:40.692Z"
  kind: "decision"
  summary: "User direction on 2026-09-12 during the 0.9.10 release review: hiding branch and worktree creation in New Workspace left User mode with no easy way to start Git work. Having basic Git backup tools does not mean removing the easiest path to create Git work, so New Workspace keeps its Git setup in User mode."
  source: "Chat with the user, 2026-09-12 release preparation"
  affects: ["user-mode","new-workspace"]
