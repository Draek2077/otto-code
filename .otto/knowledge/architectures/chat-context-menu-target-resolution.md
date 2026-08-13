---
id: "chat-context-menu-target-resolution"
kind: "architecture"
title: "Chat context menus resolve actions from the clicked target"
status: "confirmed"
tags: ["chat", "context-menu", "ux", "architecture"]
created_at: "2026-08-13T03:21:44.211Z"
updated_at: "2026-08-13T03:32:35.592Z"
---

# Chat context menus resolve actions from the clicked target

<!-- compiled_truth -->

Chat uses one shared context-menu presentation and a target/action resolver. Transcript elements contribute typed context targets, and the resolver composes only actions that are valid for the clicked item and its workspace scope. The native text-selection menu remains an intentional selection-first exception until product requirements justify replacing it with accessible in-app selection actions. Link actions are migrated into this resolver before image or further chat-target actions are added.

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
