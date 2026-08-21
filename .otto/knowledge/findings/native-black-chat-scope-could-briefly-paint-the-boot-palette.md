---
id: "native-black-chat-scope-could-briefly-paint-the-boot-palette"
kind: "finding"
title: "Native black chat scope could briefly paint the boot palette"
status: "proposed"
tags: ["mobile","theme","chat","unistyles"]
created_at: "2026-08-13T03:37:22.288Z"
updated_at: "2026-08-21T15:31:55.695Z"
---
# Native black chat scope could briefly paint the boot palette

<!-- compiled_truth -->

On native, persisted theme and appearance patches must run in the layout phase. Passive effects can let a chat pane scoped to the black theme commit one visible frame using the boot palette, producing a transient split background when settings hydrate or the first message mounts.

## Timeline

- time: "2026-08-13T03:37:22.288Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["august-ux-reliability-bug-sweep"]
- time: "2026-08-13T03:37:22.288Z"
  kind: "evidence"
  summary: "User observed a transient two-color mobile chat background around the first message. `packages/app/src/app/_layout.tsx` applied `applyColorScheme` and `applyAppearance` in `useEffect`; switched both to `useLayoutEffect` and confirmed formatter, targeted lint, and workspace typecheck pass."
- time: "2026-08-13T03:39:58.762Z"
  kind: "evidence"
  summary: "User then confirmed the broader trigger: after changing the setting, switching to retained chats left their normal backgrounds intact. This showed that native ScopedTheme captures palette at descendant mount. The native BlackChatScope now adds a fresh Fragment boundary when enabling the scope, so retained panes remount under the black palette during settings hydration or a toggle."
  source: "User reproduction, 2026-08-12"
- time: "2026-08-13T03:43:29.285Z"
  kind: "evidence"
  summary: "Correction to the preceding implementation note: the fix does not remount a Fragment inside BlackChatScope. `MobileMountedTabSlot` now subscribes directly to `blackTabBackground`, causing every retained mobile slot to reconcile its pane content when the setting changes while preserving the pane component key and its state. The root appearance patchers also run in `useLayoutEffect` to prevent the boot-palette frame."
  source: "Implementation correction, 2026-08-12"
- time: "2026-08-21T15:31:55.695Z"
  kind: "evidence"
  summary: "User reported that Android black chat backgrounds remained intermittent: absent until the first message in some drafts and lost when switching retained chats. Code inspection confirmed the earlier MobileMountedTabSlot key only reconstructed panes when blackTabBackground changed, while Unistyles ScopedTheme is a marker-scoped registry operation rather than a persistent descendant context. The correction gives the pure-black canvas an explicit React context plus core React Native #000000 style, applied by the opaque agent, stream, draft, loading/error, and communications-room canvas owners; ScopedTheme remains responsible for the richer dark palette. Verified with a focused 2-test Vitest file, targeted lint, app typecheck, formatting, and git diff check. On-device verification was unavailable because adb is not installed in the environment."
  source: "User reproduction and implementation verification, 2026-08-21"
