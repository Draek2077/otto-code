---
id: "vim-neovim-developer-workflows"
kind: "project"
title: "Vim and Neovim developer workflows"
status: "confirmed"
tags: ["developer-experience", "editor", "terminal", "neovim", "vim", "tmux", "diffs"]
delivery_status: "partial"
progress_completed: 4
progress_total: 5
progress_unit: "delivery milestones"
created_at: "2026-08-12T22:38:12.272Z"
updated_at: "2026-08-13T06:57:34.386Z"
---

# Vim and Neovim developer workflows

<!-- compiled_truth -->

# Outcome

Make Otto effective for Vim and Neovim developers without replacing Otto's normal editor or terminal model.

The supported paths are intentionally complementary:

1. **Vim keybindings in Otto's file editor** for modal editing in the existing CodeMirror editor.
2. **Real Vim and Neovim in Otto's existing xterm/PTY terminal stack**, including terminal-backed file editing.
3. **Read-only terminal compatibility diagnostics** for host capabilities.

All paths remain opt-in. Vim keybindings are an emulation layer, while the Vim and Neovim file-editor choices run the user's actual executable and configuration.

## Delivered scope

- Live, opt-in Vim keybindings in the active Otto file editor, with NORMAL/INSERT feedback, a visible pending Space-leader state, and constrained mappings to existing Otto actions.
- Sensible default Space-leader mappings that users can rebind or reset.
- A Host > Terminals compatibility check for Vim, Neovim, tmux, Difftastic, terminal capabilities, resize, alternate screen, and reconnect evidence.
- A desktop File editor preference: Otto, Vim, Neovim, or Custom.
- Terminal-backed Vim/Neovim sessions where the real editor owns the file while active and Otto reloads disk state after exit.
- Pane-owned terminal presentation so a selected Vim/Neovim file editor replaces the file content rather than creating a second workspace terminal tab.

## Product decision

**Do not build direct Neovim UI embedding or plugin RPC integration now.**

A direct `nvim --embed` UI would require Otto to own Neovim redraw grids, floating windows, popup menus, command line, font measurement, input, resize, clipboard, terminal buffers, reconnect, and recovery. That is a separate editor frontend with high ongoing plugin-compatibility risk.

The terminal-backed editor is the supported Neovim path. It preserves the user's Neovim configuration, plugins, theme, LSP, and ordinary terminal behavior without duplicating Neovim's UI protocol.

## Remaining chartered work

1. **Release and host alignment.** Ship the paired app and daemon capability together. The File editor must only be offered when the connected host advertises the embedded-terminal presentation capability; older hosts must prompt an update rather than revive tab churn.
2. **Real-host acceptance matrix.** Test Vim and Neovim on supported desktop hosts with normal user configuration: open, save, quit, file-watch reload, colors, resize, clipboard, mouse, alternate screen, and reconnect.
3. **Targeted workflow polish.** Fix only observed usability issues in the Editor settings, file-opening path, terminal presentation, error recovery, and accessibility. Keep the normal Otto editor unchanged when Otto is selected.
4. **Evidence-gated reconsideration.** Reopen direct Neovim embedding only if the terminal-backed workflow has a concrete, measured limitation that cannot be addressed through terminal improvements. A new, separately approved charter and prototype would then be required.

## Constraints

- No direct Neovim embedding, `nvim --embed`, MessagePack-RPC UI broker, or plugin-RPC product surface is in current scope.
- Preserve the xterm/daemon PTY terminal architecture.
- Never install or alter Vim, Neovim, tmux, fonts, shell configuration, or user configuration automatically.
- Terminal-backed Vim/Neovim owns the active buffer. Otto must not autosave or concurrently edit it.
- Do not infer that the unresolved “t-mark” feedback means tmux.
- New daemon-dependent functionality remains capability-gated through `server_info.features.*`.

## Acceptance criteria for remaining work

- A current app and connected host agree on the embedded-terminal capability, and selecting Vim or Neovim opens one file tab with no visible workspace-tab churn.
- The real-host acceptance matrix has recorded results for supported Windows and any other supported desktop hosts.
- Error messages clearly distinguish a missing executable, an outdated host, and a failed editor launch.
- No direct Neovim UI work begins without a separate, user-approved charter.

## Timeline

- time: "2026-08-12T22:38:12.272Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["developer-native-terminal-and-structural-diff"]
- time: "2026-08-12T22:38:12.272Z"
  kind: "evidence"
  summary: "Confirmed user decisions and repository inspection on 2026-08-12. Current terminal is xterm/PTY based, supports configurable terminal profiles, and has an alternate-screen Vim E2E check. The file editor already has opt-in CodeMirror Vim keybindings. Neovim officially supports embedding through MessagePack-RPC and nvim_ui_attach. Difftastic's official material confirms syntax-aware structural diffs, Git external-diff integration, parse-error fallback, and large-diff performance limits."
- time: "2026-08-12T23:34:58.514Z"
  kind: "note"
  summary: "Implemented the first Phase 1 slice: the existing Vim setting now reconfigures the active web/Electron CodeMirror editor live, reports NORMAL/INSERT/other Vim modes with accessible status alongside cursor position, preserves Otto shortcut callbacks, and has focused browser/core plus live E2E coverage. Terminal compatibility and terminal-backed Vim/Neovim phases remain untouched."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-12T23:44:00.211Z"
  kind: "evidence"
  summary: "2026-08-12 Phase 1A completion evidence: live Vim mode is wired through the active CodeEditor/FileTabPane route, the persisted vimKeybindings setting remains in use, and the focused file-editing E2E for persistence plus NORMAL/INSERT mode reporting passed."
  source: "packages/app/src/editor/editor-core.ts; packages/app/src/components/file-tab-pane.tsx; packages/app/e2e/file-editing.spec.ts; packages/app/e2e-report/modules/9-"
- time: "2026-08-12T23:55:36.070Z"
  kind: "note"
  summary: "Phase 1 in-app Vim mode is implemented and verified on 2026-08-12. Phase 1B adds validated Space-leader Otto action mappings, device-local persistence, local editor routing, settings controls, unit/browser tests, and focused Playwright coverage. Terminal compatibility, terminal-backed editing, direct Neovim integration, and structural diff work remain future phases."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-12T23:55:42.167Z"
  kind: "evidence"
  summary: "Phase 1B uses a device-local `vimMappings` shape with fixed `leader: \"Space\"` and a partial map for Save, Find, Go to definition, Find references, Rename symbol, File search, Changes, and New terminal. Normalization drops invalid leaders/actions/keys and keeps the first action on duplicate sequences. Mapping dispatch is local to the active CodeMirror editor and delegates to existing editor callbacks or `keyboardActionDispatcher`; modifier chords and terminal/message/browser surfaces are not claimed. `vim-mappings.test.ts`, the settings storage suite, the browser Vim suite, and the focused `file-editing.spec.ts` Playwright test passed; app typecheck and targeted lint passed."
  source: "Phase 1B implementation in packages/app and targeted verification on 2026-08-12."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-12T23:56:07.884Z"
  kind: "evidence"
  summary: "Follow-up correction, 2026-08-12: the Paseo-originated packages/app/src/file-pane/ implementation was restored as reference code to preserve upstream mergeability. Live Vim remains wired into the active Otto CM6 editor under packages/app/src/editor/."
  source: "packages/app/src/file-pane/; packages/app/src/editor/editor-core.ts"
- time: "2026-08-12T23:56:52.955Z"
  kind: "evidence"
  summary: "Boundary clarification, 2026-08-12: Vim support is additive to Otto's existing CM6 editor. The active FileTabPane/CodeEditor, preview/split viewer, buffer ownership, save/watcher/conflict semantics, and terminal stack remain the product baseline. Enabling Vim keybindings adds an editing mode; it is not a replacement or justification for removing editor implementations that may be useful for Paseo mergeability."
  source: "User clarification, 2026-08-12; packages/app/src/editor/editor-core.ts; packages/app/src/components/file-tab-pane.tsx"
- time: "2026-08-13T00:02:23.133Z"
  kind: "decision"
  summary: "The user explicitly required a review of the underpowered Refactor/Refine diff before it is fixed, and asked for a coherent way to bring improved structural diffing to Changes, the main Diff viewer, and all other diffs."
  source: "User direction on 2026-08-12."
- time: "2026-08-13T00:03:00.869Z"
  kind: "decision"
  summary: "The user clarified that “Difftastic view” means Difftastic's superior structural, side-by-side presentation of changes, rather than merely invoking the difft command or changing diff colors."
  source: "User clarification on 2026-08-12."
- time: "2026-08-13T00:04:33.305Z"
  kind: "decision"
  summary: "The user explicitly requested the ultimate diff feature set and a Settings toggle that lets users choose whether the normal line-based view or the Difftastic-style structural view is the default."
  source: "User decision on 2026-08-12."
- time: "2026-08-13T00:06:57.822Z"
  kind: "decision"
  summary: "The user clarified that Vim/Neovim and Difftastic-style diff work were reported together but are fully independent projects. This charter now contains only Vim, Neovim, and terminal workflow scope."
  source: "User decision on 2026-08-12."
- time: "2026-08-13T00:15:00.010Z"
  kind: "note"
  summary: "Phase 2 implementation is in place: a host-scoped, read-only terminal compatibility diagnostic uses the existing daemon-owned PTY/session stack, adds the dotted terminal.compatibility.diagnostic.request/response protocol pair, advertises the optional terminalCompatibilityDiagnostic server feature, exposes the check from Host > Terminals, and documents the conservative compatibility matrix. Focused protocol/server tests, the existing Vim mapping test, client/server/app typechecks, targeted lint/format checks, and the E2E coverage validator pass. The focused Playwright E2E could not start because the pinned Chromium executable is absent; npm run browsers:install timed out before installing it. No configuration is installed or mutated, and no main daemon was restarted."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-13T00:42:57.786Z"
  kind: "note"
  summary: "Phase 3 implementation is in place: a desktop-only Off/Vim/Neovim/Custom preference defaults to Off; the active File Editor exposes a host-gated external-editor action; the existing Otto terminal manager and TerminalPane own the dedicated session; the external process is authoritative while the standard CodeMirror buffer and autosave path are unmounted; daemon file watches surface disk changes/deletion and the standard editor remounts from disk after exit. Focused command/capability and settings tests, app typecheck, targeted lint, formatting, and E2E coverage mapping pass. The desktop Playwright lane could not execute because the pinned Chromium executable is missing in the environment."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-13T00:43:39.846Z"
  kind: "evidence"
  summary: "Phase 3 implementation verification: targeted command/capability tests passed (3 tests), settings persistence suite passed (103 tests), app typecheck and targeted lint passed, targeted formatting check passed, and the E2E coverage checker reports all spec files mapped. Desktop-gated E2E coverage now exercises terminal ownership, external write followed by standard-editor reload, missing custom executable failure, disk edits while external owns the file, and reconnect handling. The desktop Playwright run remains pending because the pinned Chromium executable is absent in the current environment."
  source: "packages/app/src/components/external-file-editor-pane.tsx; packages/app/e2e/file-editing.spec.ts; docs/text-editor.md"
- time: "2026-08-13T01:07:27.073Z"
  kind: "evidence"
  summary: "Phase 4 evaluation evidence, 2026-08-12: the Phase 3 hard precondition is not yet satisfied. The terminal-backed editor implementation and focused checks are present, but the desktop Playwright lane is gated by E2E_DESKTOP_RUNTIME=1 and the recorded verification states that the pinned Chromium executable is absent, so the desktop ownership/lifecycle E2E has not run. Targeted checks independently passed: external-editor command/capability 3/3, terminal compatibility diagnostic 3/3, settings storage 103/103, and e2e:coverage mapping passed. Official Neovim documentation confirms direct embedding requires a dedicated nvim --embed MessagePack-RPC UI: nvim_ui_attach startup gating, ordered redraw batches committed at flush, ext_linegrid/multigrid rendering, mode/cursor state, externalized cmdline/messages/popupmenu/tabline, buffer update events, extmarks, input, resize, clipboard integration, async error handling, and reconnect/detach lifecycle. This is materially separate from the existing xterm/PTY terminal stack. The evidence-gated recommendation is no-go for production Phase 4 implementation now; defer direct embedding and retain the terminal-backed editor as the supported Neovim path until Phase 3 desktop verification completes. If reconsidered, the exact feature gate must be a new server_info.features.directNeovimUi capability, offered only on Electron desktop and only after a daemon-owned resident RPC broker validates the executable/API metadata and recovery contract; mere nvim PATH availability is insufficient. No prototype, route, protocol, or ownership replacement was built."
  source: "2026-08-12 Phase 4 evaluation: docs/text-editor.md; docs/terminal-compatibility.md; packages/app/src/components/external-file-editor-pane.tsx; packages/app/src/"
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-13T01:27:35.778Z"
  kind: "evidence"
  summary: "Correction to the earlier Chromium-blocked note: Microsoft Edge was available and used for the desktop Playwright lane. `E2E_BROWSER_CHANNEL=msedge E2E_DESKTOP_RUNTIME=1 npx playwright test --project=\"Desktop Chrome\" e2e/file-editing.spec.ts` completed exit 0 with 5 passed and 7 skipped. The reconnect ownership test also passed in isolation (1 passed) and in the clean full-file rerun (14.2s). The first Edge full-file attempt had one intermittent reconnect failure showing a temporary workspace-unavailable screen; it was not a browser-launch failure. Phase 3 desktop ownership/lifecycle behavior is therefore verified against Edge, and the prior 'Chromium absent means Phase 3 is unverified' conclusion is superseded by this measured result. The docs/testing.md Edge escape hatch was the correct route."
  source: "2026-08-13 targeted Phase 3 verification using Microsoft Edge via E2E_BROWSER_CHANNEL=msedge."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-13T06:57:15.984Z"
  kind: "decision"
  summary: "The user confirmed that direct Neovim UI embedding is a no-go for now and requested that any remaining work be retained in the existing charter before stopping."
  source: "User decision, 2026-08-13."
  affects: ["vim-neovim-developer-workflows-requirement"]
- time: "2026-08-13T06:57:34.386Z"
  kind: "note"
  summary: "In-app Vim mode, terminal diagnostics, terminal-backed Vim/Neovim editing, and the direct-Neovim-embedding evaluation are complete. The evaluation concluded no-go; remaining work is release/host alignment and real-host acceptance, not a native Neovim UI build."
  affects: ["vim-neovim-developer-workflows"]
