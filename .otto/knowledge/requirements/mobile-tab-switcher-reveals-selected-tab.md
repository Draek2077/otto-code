---
id: "mobile-tab-switcher-reveals-selected-tab"
kind: "requirement"
title: "Mobile tab switcher reveals the selected tab"
status: "proposed"
tags: ["workspace", "tabs", "mobile", "bottom-sheet", "ui"]
created_at: "2026-08-14T00:31:30.843Z"
updated_at: "2026-08-14T00:31:30.843Z"
---

# Mobile tab switcher reveals the selected tab

<!-- compiled_truth -->

When the compact/mobile workspace tab switcher bottom sheet opens, it automatically scrolls the selected tab into the visible list and centers it when space permits. Users must not need to manually scroll through the tab list merely to locate their current tab.

## Timeline

- time: "2026-08-14T00:31:30.843Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T00:31:30.843Z"
  kind: "evidence"
  summary: "User request, 2026-08-13: \"In mobile in the tab switcher, could we have the UI auto scroll to have the current selected tab in view? I dont like having to scroll to it in that bottomsheet\". Implemented through the opt-in mobile combobox behavior used by `MobileWorkspaceTabSwitcher` in `packages/app/src/screens/workspace/workspace-screen.tsx`."
