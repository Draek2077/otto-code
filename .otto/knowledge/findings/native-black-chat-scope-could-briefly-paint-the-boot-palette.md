---
id: "native-black-chat-scope-could-briefly-paint-the-boot-palette"
kind: "finding"
title: "Native black chat scope could briefly paint the boot palette"
status: "proposed"
tags: ["mobile", "theme", "chat", "unistyles"]
created_at: "2026-08-13T03:37:22.288Z"
updated_at: "2026-08-13T03:43:29.285Z"
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
