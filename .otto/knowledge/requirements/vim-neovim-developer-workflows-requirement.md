---
id: "vim-neovim-developer-workflows-requirement"
kind: "requirement"
title: "Vim and Neovim developer workflows"
status: "confirmed"
tags: ["developer-experience", "editor", "terminal", "vim", "neovim", "tmux"]
created_at: "2026-08-13T00:05:57.397Z"
updated_at: "2026-08-13T00:05:57.397Z"
---

# Vim and Neovim developer workflows

<!-- compiled_truth -->

Otto will support a complete opt-in Vim and Neovim experience, disabled by default: native-feeling modal Vim editing in Otto's built-in editor; compatibility for existing Vim, Neovim, and terminal-multiplexer workflows in the terminal; a terminal-backed file editor that runs the user's real Vim or Neovim process; and an evidence-gated evaluation of direct Neovim embedding. In-app Vim mode is emulation and must not claim arbitrary Vim runtime/plugin compatibility. Real external editor sessions own their buffer while open. Terminal-backed and embedded modes are desktop-first, user-controlled, and preserve the existing terminal stack.

## Timeline

- time: "2026-08-13T00:05:57.397Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T00:05:57.397Z"
  kind: "evidence"
  summary: "User decision on 2026-08-12 to split Vim/Neovim work from Difftastic-style diff work into separate projects."
