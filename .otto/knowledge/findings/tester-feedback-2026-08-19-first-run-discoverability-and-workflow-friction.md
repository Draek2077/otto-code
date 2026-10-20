---
id: "tester-feedback-2026-08-19-first-run-discoverability-and-workflow-friction"
kind: "finding"
title: "Tester feedback: first-run discoverability and workflow friction"
status: "proposed"
tags: ["tester-feedback","onboarding","discoverability","developer-experience","triage"]
created_at: "2026-08-20T05:08:06.231Z"
updated_at: "2026-08-20T05:33:22.853Z"
---
# Tester feedback: first-run discoverability and workflow friction

<!-- compiled_truth -->

A tester’s first Otto session reported difficulty discovering setup and workflow controls, ambiguous Project/Workspace/worktree terminology, unclear Claude Auto Mode state, keyboard and composer friction, external-editor tab-close behaviour, attachment presentation/search quality, and repeated SSH-key unlock prompts apparently triggered by background Git fetch. The reports are user observations, not yet implementation-verified. The feedback also indicates that capabilities which may exist (Settings search, structural diff, Vim/Neovim, pane splits, shortcuts) are not reliably discoverable.

## Timeline

- time: "2026-08-20T05:08:06.231Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["git-fetch-control","settings-search-navigates-to-setting-row","contextual-shortcut-discovery","vim-neovim-developer-workflows-requirement","difftastic-informed-native-diff-design"]
- time: "2026-08-20T05:08:06.231Z"
  kind: "evidence"
  summary: "Tester discussion supplied by the product owner on 2026-08-19. Follow-up must reproduce each observation and separate actual defects from naming, navigation, and onboarding failures."
- time: "2026-08-20T05:20:06.950Z"
  kind: "evidence"
  summary: "Product-owner triage: Otto’s Claude Auto Mode label may be an Otto-owned mode rather than Claude Code’s Auto Mode; investigate clarity/mismatch but do not assume it should mirror Claude Code. First-workspace onboarding is already understood as a problem: a missing README could offer Create Documentation instead of View Documentation, and the New Workspace screen could offer an empty chat as an alternative start, though composing a first query remains the intended primary step. Settings search is known to omit many settings and needs a systematic indexing audit. Structured diff is Difftastic-informed native functionality; its option placement and terminology will be handled in a separate review. Terminal-backed editor close/reopen is confirmed as a bug to fix. LaTeX and .vimrc support are planned additions. Git-fetch key-unlock reports remain unreproduced; additional logging has been added to diagnose them. Defer shortcut and pane-navigation work for now."
  source: "Product owner triage, 2026-08-19"
  affects: ["git-fetch-control","settings-search-navigates-to-setting-row","vim-neovim-developer-workflows-requirement","difftastic-informed-native-diff-design","markdown-editing"]
- time: "2026-08-20T05:33:22.853Z"
  kind: "evidence"
  summary: "Implemented three immediate improvements: terminal-backed Vim/Neovim exit (`:q`) now closes the owning file tab instead of returning to the built-in editor, with duplicate terminal-exit notifications guarded; New Workspace shows Create documentation when README detection completes with no README, submitting a first request to create README.md; Settings search now finds Bitbucket through Providers, Difftastic through Diff presentation, and automatic Git fetch/SSH/private-key terms through the Host Workspaces page. Targeted lint and app typecheck passed; focused Vitest files passed 9 tests. This does not complete the planned systematic Settings-search catalog audit."
  source: "Implementation verification, 2026-08-19"
  affects: ["git-fetch-control","settings-search-navigates-to-setting-row","vim-neovim-developer-workflows-requirement","difftastic-informed-native-diff-design"]
