---
id: "otto-0-10-editor-restoration"
kind: "project"
title: "Otto 0.10 File Editor restoration"
status: "proposed"
tags: ["otto-0.10","editor","paseo-0.12","restoration"]
delivery_status: "complete"
progress_completed: 8
progress_total: 8
progress_unit: "acceptance checkpoints"
created_at: "2026-11-04T20:07:39.075Z"
updated_at: "2026-11-05T03:23:36.856Z"
---
# Otto 0.10 File Editor restoration

<!-- compiled_truth -->

# File Editor restoration on Paseo 0.12

Philippe promoted the deferred File Editor, file viewers, code intelligence and shipped Solution Files integrations on 2026-11-04. The implementation is integrated on `otto-0.10/phase-0` in `C:/Users/phili/Projects/otto-code/.claude/worktrees/otto-0.10`. Indexed specification: `docs/otto-editor.md`; testing contracts: `docs/testing.md`.

## Delivered architecture and scope

1. **Paseo buffer ownership retained.** The existing FileEditorModel remains the owner of revision-checked save, observation, autosave, BOM, conflict and reconnect behavior. Otto adds typed presentation ports and small OTTO-tagged seams. Existing immediate Vim-keybinding controls, Find/replace and viewer security remain supported.
2. **Host-owned code intelligence.** Lazy bundled TypeScript/JavaScript and Pyright plus discovered C# servers have mirrored documents, cancellation, leases, bounded pools, idle shutdown and explicit management. Settings use revision checks and preserve unknown/legacy data. No automatic global language-server or user-config installation.
3. **Integrated semantic tools.** Completion, hover/compact Inspect, definition, references, diagnostics and outline/navigation run through one validated capability boundary. Reviewed rename and project search/replace use exact byte/revision pins, dirty-buffer guards and reversible apply/undo. Syntactic indexes are labeled and do not masquerade as semantic results.
4. **Editor controls and settings.** Code actions, measured status metadata, cursor/selection, shortcut configuration and per-editor Vim mappings are restored in owned modules. Paseo Find retains its platform policy and Mod+G; Go to line defaults to Alt+G. Editor settings do not overwrite the immediate Vim preference.
5. **Source, Markdown and viewers.** Offline native CodeMirror, retained Source/Split/Preview, selection/undo, persisted splitter preferences, Markdown tools/tables/links/paste/images, source-backed review notes, bounded host-owned asset writes and exclusive HTML/PDF export are integrated. Existing image gestures and sandboxed viewer paths remain. Live Markdown rendering remains Paseo's MD4C; export uses a separate static converter.
6. **Actual terminal editors.** Vim, Neovim and Custom run as real file-owned PTYs through Paseo's terminal stack, with literal argv, captured preferences, adoption/recovery, dirty-close confirmation and refresh on return. Terminal buffers are not concurrently autosaved by Otto. Direct nvim --embed remains excluded.
7. **Shipped Solution Files scope.** Opt-in read-only .NET solution folders/projects/evaluated files/references/packages are restored using the host's SDK/MSBuild and a packaged portable .NET8 payload. Language-server and sidecar processes share a bounded host budget. No unshipped solution mutation engine is fabricated.
8. **Packaging and validation.** Native assets, language-server dependencies and .NET payloads are included through owning server/desktop/Docker/Nix/EAS build paths. Normal commit hooks retain formatting, lint and every workspace typecheck, serialized with bounded formatter/linter threads.

## Provider and ownership rules

Editor attachments and review notes use the ordinary provider-neutral Composer. Refactor with AI opens a scoped chat draft only; it does not launch an agent or generate/apply a patch. The separate CLI-isolation investigation remains parked. Relay/Hub transport identity is unchanged. User settings, credentials and unrelated work are preserved.

## Acceptance boundaries

CI acceptance exercises actual TypeScript, Pyright and C#/.NET fixtures; the shipped native editor HTML in Chromium; isolated, network-blocked Electron PDF export; wide/compact app flows; real Vim/Neovim/Custom PTYs; and existing Paseo Find/save/conflict/reconnect/viewer cases. Native editor bridge proof is not physical Android/iOS IME proof. Personal Vim/Neovim configurations, clipboard/plugins and every host environment remain user acceptance rather than a claimed universal guarantee. Existing iOS signing gate is retained. No Otto Release installation, installed-daemon restart, public release or main landing is part of this effort.

## Verification

Final delivery status and exact CI/product-build evidence are recorded in the append-only timeline. Product-build evidence must identify the built commit; test/document-only successors may reuse it only with verified identical production and packaging inputs.

## Timeline

- time: "2026-11-04T20:07:39.075Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["file-editor","code-intelligence","vim-neovim","solution-view"]
- time: "2026-11-04T20:07:39.075Z"
  kind: "evidence"
  summary: "User 2026-11-04: 'lets get file editor and editor specific items closed out and fully implemented back in ... mindful of any advancements ... Paseo 0.12.0 ... code servers ... fully end to end'. Current implementation branch otto-0.10/phase-0, starting SHA 1a01abb75c2bdf6a662f1e10b19801154c917449; historical source otto-0.9-final and Paseo v0.12.0 compared. Frozen docs/code-intelligence.md identifies the code-server architecture as daemon-owned LSP."
- time: "2026-11-05T03:23:21.114Z"
  kind: "decision"
  summary: "The promoted File Editor restoration is now integrated, committed and verified. Replace the charter-creation statement that no source existed with the delivered scope, architecture and explicit acceptance boundaries. Full required CI, editor/Paseo journeys, all-Otto journeys, runtime proofs and product builds are successful; review status remains proposed."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["file-editor","code-intelligence","vim-neovim","solution-view"]
- time: "2026-11-05T03:23:33.395Z"
  kind: "evidence"
  summary: "Verified 2026-11-05 UTC on otto-0.10/phase-0, final pushed commit 1b4c76aa615e20e91f09985c8f0ac7343178c41c.\n\n- Full required CI: https://github.com/Draek2077/otto-code/actions/runs/41958046132 — every job successful, including all eight Playwright shards, all workspace/package checks, server/CLI tests and desktop renderer tests.\n- Otto app acceptance: https://github.com/Draek2077/otto-code/actions/runs/41956398828 — 71/71 journeys, 24.1 minutes, zero retries.\n- Focused editor and Paseo baseline: https://github.com/Draek2077/otto-code/actions/runs/41956402746 — 5/5 restored editor journeys (wide, compact, real Vim, Neovim and Custom PTYs), 12/12 unchanged Paseo Find journeys and 24/24 existing file-editing/save/conflict/reconnect/viewer cases.\n- Runtime proof: https://github.com/Draek2077/otto-code/actions/runs/41956398831 — actual C#/.NET semantic fixture, shipped offline native editor document in Chromium, and isolated Electron PDF. Downloaded PDF/result verified locally: 16,535 bytes, valid %PDF- header, zero network requests. Bundled TypeScript/Pyright and .NET/MSBuild fixtures passed in the normal owning CI stack.\n- Desktop builds and smoke checks: https://github.com/Draek2077/otto-code/actions/runs/41955260590 — Windows, Linux, installed Linux and unsigned Intel/Apple Silicon macOS all successful.\n- Android APK + AAB: https://github.com/Draek2077/otto-code/actions/runs/41955265333 — successful, retained artifact sizes 164,691,640 and 250,747,677 bytes respectively.\n- Nix Linux + macOS: https://github.com/Draek2077/otto-code/actions/runs/41955255779 — successful.\n- Docker build: https://github.com/Draek2077/otto-code/actions/runs/41955269183 — successful, publishing disabled.\n\nPackaging runs built c0130fdbe5c75271e98f3556af4084a5cea96c0c. Verified git diff c013..final contains ONLY docs/testing.md and packages/app/e2e/browser/otto-editor.spec.ts; production, dependency, native-asset and packaging inputs are identical. Full CI, runtime and app acceptance above ran the final 1b4 commit. No public release or installed-app update was performed; installed Otto/settings/daemon were untouched.\n\nReviewed retained CI wide/compact Split screenshots and the saved-file return from the Neovim journey. Physical-device Android/iOS IME and personal Vim/Neovim/plugin configurations remain manual acceptance boundaries, not claimed CI evidence. Existing iOS signing gate retained. Direct nvim embedding and direct editor CLI generation/isolation remain excluded. Indexed docs/otto-editor.md describes current behavior; docs/testing.md records the coverage and retained UI selector contracts. No worktree or agent was created for this effort."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["file-editor","code-intelligence","vim-neovim","solution-view"]
- time: "2026-11-05T03:23:36.856Z"
  kind: "note"
  summary: "All eight promoted restoration checkpoints are implemented and integrated. Final commit 1b4c76aa6 has green full required CI, 71 Otto journeys, 41 focused editor/Paseo checks and runtime proofs. Windows/Linux, unsigned Intel+ARM Mac, Android APK+AAB, Nix and Docker builds passed with verified identical production inputs (build SHA c013; final successor changes tests/docs only). The timeline retains exact runs and physical-device/personal-configuration boundaries. Review status stays proposed; no release/main landing or installed-app changes."
  affects: ["otto-0-10-editor-restoration"]
