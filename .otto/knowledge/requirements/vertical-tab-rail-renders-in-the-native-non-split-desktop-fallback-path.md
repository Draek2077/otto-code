---
id: "vertical-tab-rail-renders-in-the-native-non-split-desktop-fallback-path"
kind: "requirement"
title: "Vertical tab rail renders in the native non-split desktop fallback path"
status: "confirmed"
tags: ["workspace", "tabs", "orientation", "native", "android"]
created_at: "2026-08-18T12:31:43.904Z"
updated_at: "2026-08-18T12:31:43.904Z"
---

# Vertical tab rail renders in the native non-split desktop fallback path

<!-- compiled_truth -->

The workspace tab-orientation toggle must work on native devices: in the non-split desktop fallback path (`!isMobile && !canRenderDesktopPaneSplits` — landscape phones and tablets), the vertical orientation renders `WorkspaceDesktopTabsRail` as a left column beside the center content, and horizontal keeps `WorkspaceDesktopTabsRow` above it. Fresh installs default to vertical, so a new landscape phone lands on the rail.

## Timeline

- time: "2026-08-18T12:31:43.904Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workspace-screen-tsx"]
- time: "2026-08-18T12:31:43.904Z"
  kind: "evidence"
  summary: "User direction: \"jesus i think i made it pretty clear i want the damn tabs\" — vertical tabs must be implemented on mobile, not hidden or scope-limited. Implementation in `packages/app/src/screens/workspace/workspace-screen.tsx`: the fallback branch was split on `fallbackTabOrientation`; vertical wraps `WorkspaceDesktopTabsRail` (paneId, tabs, focusedTab, full tab-action props, `showPaneSplitActions: false`, `onSplitRight/Down: noop`) and `centerContentNode` (extracted `WorkspaceCenterContent`) in `styles.fallbackVerticalTabsRow` (flex row, flex:1, minHeight:0). No store changes were needed — `fallbackTabOrientation` resolves `pane.tabOrientation ?? settings.defaultTabOrientation` and the existing toggle handler already persisted. Rail is platform-neutral (RN + reanimated + gesture-handler); native `SortableInlineList` is a static list matching the horizontal row's existing native behavior. Verified: `tsgo --noEmit` clean, eslint 0 errors on the file, and user confirmed on a real Android device: \"i see vertical tabs now in android. its working.\" (2026-08-14)"
