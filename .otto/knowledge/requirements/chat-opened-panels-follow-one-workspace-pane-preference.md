---
id: "chat-opened-panels-follow-one-workspace-pane-preference"
kind: "requirement"
title: "Chat-opened panels follow one workspace pane preference"
status: "confirmed"
tags: ["workspace","panes","tabs","settings","interaction-design"]
created_at: "2026-09-19T20:38:31.585Z"
updated_at: "2026-10-02T14:15:37.970Z"
---
# Chat-opened panels follow one workspace pane preference

<!-- compiled_truth -->

Desktop Settings → Layout provides one **Opening another panel from a chat** preference for supporting, non-chat tabs opened from an agent, draft, or provider-subagent chat.

- **Main panel** is the default and keeps the supporting tab in the chat's pane without creating a split.
- **On the side** creates one full-height pane to the right of the workspace root, then reuses that same pane for later supporting tabs.
- Opening another chat or the empty New Tab launcher keeps normal chat placement.
- Existing targets remain where the user moved them, explicit Main/Side actions retain their meaning, and compact layouts ignore the desktop placement preference.
- Revealing the side pane clears a conflicting maximized-pane presentation so the requested destination is visible.

## Timeline

- time: "2026-09-19T20:38:31.585Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-19T20:38:31.585Z"
  kind: "evidence"
  summary: "Requested explicitly by the user on 2026-09-19. Implemented through the shared workspace target routing and existing `ensureSidePane` primitive in `packages/app/src/screens/workspace/workspace-screen.tsx` and `packages/app/src/workspace-tabs/open-beside.ts`, with the device-local setting in `packages/app/src/screens/settings/layout/layout-section.tsx`. Verified with 168 focused unit tests covering default/no-split, right-pane creation and reuse, chat/non-chat classification, preference migration, settings catalog integrity, and maximized-pane restoration. App typecheck, targeted lint, formatting, and `git diff --check` passed. The existing Otto preview server was running but its bound browser view was detached, so packaged/native runtime interaction remains unproven in this effort."
- time: "2026-10-02T14:15:37.970Z"
  kind: "evidence"
  summary: "2026-10-02: User reported that AI-created browser and preview tabs still opened a third pane when a second pane already existed. Current code confirmed the gap: ensureSidePane reused only an app-remembered side pane, while a manually split second pane had no remembered ID; toolbar previews and hosted tab adoption also had direct split paths. Repair adopts the existing second pane for native AI browser and preview tabs, toolbar previews, and daemon-hosted tabs, preserving chat pane focus. Focused native automation tests (19) and hosted Chromium tests (7), app typecheck, targeted lint, formatting, and diff checks pass. Installed/native interaction remains unverified."
  source: "packages/app/src/stores/workspace-layout-store.ts; packages/app/src/desktop/browser/automation/handler.test.ts; packages/app/src/screens/workspace/use-hosted-br"
