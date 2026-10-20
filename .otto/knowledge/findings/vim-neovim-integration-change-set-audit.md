---
id: "vim-neovim-integration-change-set-audit"
kind: "finding"
title: "Vim and Neovim integration change-set audit"
status: "proposed"
tags: ["vim", "neovim", "security", "editor", "terminal", "review"]
created_at: "2026-08-13T07:56:47.094Z"
updated_at: "2026-08-13T08:33:19.061Z"
---

# Vim and Neovim integration change-set audit

<!-- compiled_truth -->

Review of commit `d4ee22075` identified unresolved release-blocking observations:

1. **Untrusted file paths are passed to Vim/Neovim without an end-of-options delimiter.** `resolveExternalFileEditorCommand` appends the workspace-relative path directly. Root-level names beginning with `+` or `-` are therefore parsed as editor command-line arguments; Neovim documents `+{command}` as executable Ex input and `--` as the required delimiter before option-like filenames.
2. **External-editor sessions have no unsaved-work close guard.** File-tab close checks only Otto's CodeMirror buffer, while unmount unconditionally kills the embedded terminal. Closing the tab, changing File editor mode, or crossing the compact-layout breakpoint can terminate Vim/Neovim with unsaved edits.
3. **Embedded terminal ownership is not recoverable after a renderer reload/crash.** The pane always creates a new session, while embedded sessions are hidden from terminal tabs and daemon terminal sessions survive client-controller disposal. A reload can leave an unreachable process and launch a second editor for the same file.
4. **Two-character Vim leader mappings are accepted and persisted but cannot dispatch.** The handler tracks only a boolean pending state and compares each key in isolation rather than accumulating the sequence. Escape while pending also replays Space despite the UI describing Escape as cancellation.
5. **The alternate-screen diagnostic is a false-positive check.** It finds the entry marker in raw streamed output and the exit marker in the final normal-screen grid, which succeeds even if alternate-screen control sequences were ignored.
6. **Native users can enable a setting that is hard-disabled at execution.** The Settings switch remains visible and its hint no longer states the web/desktop limitation, while `resolveVimKeybindings` forces false off web.
7. **Older-host behavior is silent fallback, not the chartered update prompt.** The editor preference is shown without consulting host capabilities, but file opening simply disables the external path when either capability is absent.

## Timeline

- time: "2026-08-13T07:56:47.094Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["vim-neovim-developer-workflows","vim-neovim-developer-workflows-requirement"]
- time: "2026-08-13T07:56:47.094Z"
  kind: "evidence"
  summary: "Static review of d4ee22075 and current code on 2026-08-13: packages/app/src/editor/external-file-editor.ts; packages/app/src/components/external-file-editor-pane.tsx; packages/app/src/components/file-tab-pane.tsx; packages/app/src/panels/file-panel.tsx; packages/app/src/screens/workspace/terminals/state.ts; packages/app/src/editor/editor-core.ts; packages/server/src/terminal/terminal-session-controller.ts; packages/server/src/terminal/terminal-compatibility-diagnostic.ts. Neovim official starting documentation confirms +{command} execution and -- filename delimiting."
- time: "2026-08-13T08:33:19.061Z"
  kind: "evidence"
  summary: "Patched all seven audit findings. File launches now use canonical absolute paths and `--` for Vim/Neovim; embedded editor terminals carry a stable presentation owner, deduplicate in the daemon, survive renderer unload, and are adopted after reload; tab and bulk close copy warns before process termination; active launch configuration is frozen across settings/layout changes; Vim mappings accumulate two-character sequences, Escape cancels without replay, and timers are disposed; the PTY diagnostic now emits a real ESC on Windows, snapshots the live alternate buffer, and verifies restoration of the primary buffer; native hides the unsupported Vim toggle; desktop settings and file panes capability-gate older hosts with an explicit update message. Verification: protocol 2/2, launcher 5/5, terminal manager 39/39, session controller 11/11, PTY diagnostic 5/5, browser Vim 4/4; build:server, repository typecheck, and targeted lint passed."
  source: "workspace patch and focused verification on 2026-08-13"
  affects: ["vim-neovim-developer-workflows"]
