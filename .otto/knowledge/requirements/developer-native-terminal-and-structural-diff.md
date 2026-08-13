---
id: "developer-native-terminal-and-structural-diff"
kind: "requirement"
title: "Developer-native terminal and structural diff"
status: "confirmed"
tags: ["terminal", "developer-experience", "diffs", "research"]
created_at: "2026-08-12T22:05:20.085Z"
updated_at: "2026-08-12T22:33:42.166Z"
---

# Developer-native terminal and structural diff

<!-- compiled_truth -->

Otto will support a complete, opt-in Vim and Neovim experience, with every capability disabled by default: (1) native-feeling modal Vim editing in Otto's built-in editor, with discoverable configuration and Otto-action mappings; (2) terminal compatibility for users' existing Vim, Neovim, and terminal-multiplexer workflows and configuration; (3) a terminal-backed file editor that renders an actual user-installed Vim or Neovim process inside Otto's file-editor pane; and (4) an evaluated direct Neovim integration using Neovim's embedding API, pursued after the terminal-backed path establishes the necessary lifecycle and compatibility model. The built-in editor mode is emulation, never a claim to be a full Vim/Neovim runtime. Terminal-backed and embedded options must make the real runtime authoritative for its buffer. All features must be clearly named, user-controlled, and desktop-first where terminal ergonomics require it. Structural diffs remain a separately evaluated, syntax-aware review opportunity; Difftastic is a benchmark and possible optional integration, not a global replacement for Git's line diff.

## Timeline

- time: "2026-08-12T22:05:20.085Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T22:05:20.085Z"
  kind: "evidence"
  summary: "User feedback on 2026-08-12: terminal-native developers rely on familiar knowledge/task tools and cited Vim configuration, an ambiguous “t-mark” terminal setup, and Difftastic as an example of better diffs. Repository inspection confirms the existing terminal uses xterm and exposes configurable shell profiles; the current Changes view is a custom line-based viewer. Difftastic's official documentation describes syntax-aware structural diffs, Git external-diff integration, line-based fallback on parse errors, and large-diff performance limitations."
- time: "2026-08-12T22:28:17.010Z"
  kind: "decision"
  summary: "The user explicitly chose both an opt-in Vim-style built-in editor experience and opt-in support for running existing Vim/Neovim/tmux terminal workflows. The defaults remain off so users retain the normal Otto experience and can trial the capability safely."
  source: "User decision on 2026-08-12."
- time: "2026-08-12T22:28:23.267Z"
  kind: "note"
  summary: "The user explicitly confirmed the requirement and opt-in-by-default policy on 2026-08-12. New status: confirmed."
- time: "2026-08-12T22:33:42.166Z"
  kind: "decision"
  summary: "The user explicitly expanded the confirmed requirement to include every complementary Vim path: native-feeling in-app modal editing, compatible real Vim/Neovim/tmux terminal use, a terminal-backed Vim/Neovim file editor, and a future direct Neovim integration."
  source: "User decision on 2026-08-12."
