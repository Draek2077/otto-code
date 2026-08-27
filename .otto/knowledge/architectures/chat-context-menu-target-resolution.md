---
id: "chat-context-menu-target-resolution"
kind: "architecture"
title: "Chat context menus resolve actions from the clicked target"
status: "confirmed"
tags: ["chat","context-menu","ux","architecture"]
created_at: "2026-08-13T03:21:44.211Z"
updated_at: "2026-08-27T13:47:52.283Z"
---
# Chat context menus resolve actions from the clicked target

<!-- compiled_truth -->

Chat uses one shared target/action context-menu presentation. Transcript elements contribute typed context targets, and the resolver composes only actions valid for the clicked item and workspace scope.

A root `TextSelectionMenuProvider` owns normal rendered-text selection throughout Otto’s desktop and browser UI. It supplies the standard **Cut**, **Copy**, **Paste**, and **Select all** actions according to whether the target is editable and whether it has a selection; every row displays its platform shortcut. Text selection wins over an ordinary target menu, so a selected label remains copyable.

A surface that needs both target-specific and selection actions uses `TextSelectionMenuHybridScope` and `useTextSelectionContextMenu().open(...)` to prepend its local actions above the shared standard group. Browser guests and isolated webviews retain their native menus because their selections are not owned by the Otto renderer.

## Timeline

- time: "2026-08-13T03:21:44.211Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["chat-detected-links-expose-terminal-equivalent-actions"]
- time: "2026-08-13T03:21:44.211Z"
  kind: "evidence"
  summary: "User requested a flexible unified chat context menu that adapts to links, selected text, images, and future chat targets. Code inspection: AgentPanel owns the transcript context menu; ContextMenuTrigger deliberately preserves the native text-selection menu; detected links currently have a standalone contextual wrapper; image attachments currently provide a lightbox only."
- time: "2026-08-13T03:32:35.592Z"
  kind: "note"
  summary: "User explicitly approved implementation of the shared target-resolved chat context menu. New status: confirmed."
- time: "2026-08-27T13:38:49.652Z"
  kind: "decision"
  summary: "The user explicitly approved replacing native selection menus with shared Otto-owned text actions, and the root provider plus hybrid Knowledge review integration are implemented and typechecked."
  source: "Implementation: packages/app/src/components/text-selection-menu/text-selection-menu.web.tsx, packages/app/src/app/_layout.tsx, packages/app/src/project-knowledg"
- time: "2026-08-27T13:47:52.283Z"
  kind: "decision"
  summary: "Keep the durable architecture record scoped to the reusable text-menu capability so its commit remains independent of the pre-existing untracked Knowledge review feature bundle."
  source: "Implementation: packages/app/src/components/text-selection-menu/text-selection-menu.web.tsx, packages/app/src/app/_layout.tsx; verification: focused Vitest, app"
