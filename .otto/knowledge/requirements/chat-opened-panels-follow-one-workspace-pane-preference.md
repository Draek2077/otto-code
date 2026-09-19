---
id: "chat-opened-panels-follow-one-workspace-pane-preference"
kind: "requirement"
title: "Chat-opened panels follow one workspace pane preference"
status: "confirmed"
tags: ["workspace","panes","tabs","settings","interaction-design"]
created_at: "2026-09-19T20:38:31.585Z"
updated_at: "2026-09-19T20:38:31.585Z"
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
