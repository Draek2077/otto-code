---
id: "communications-popup-conversation-navigation"
kind: "requirement"
title: "Communications popup conversation navigation"
status: "proposed"
tags: ["communications", "zoom", "title-bar", "chat", "navigation", "popup", "proposed"]
created_at: "2026-08-15T05:36:06.637Z"
updated_at: "2026-08-15T05:36:06.637Z"
---

# Communications popup conversation navigation

<!-- compiled_truth -->

Proposed interaction model: the title-bar communications popup is a persistent, navigable surface. Its root prioritizes unread notifications, then recent conversations. Selecting a notification or conversation enters a child conversation view within the same popup, with a back affordance in the header that restores the root view and its scroll position. The conversation child shows a scrollable message log and a pinned message composer.

On desktop, the popup may be resized from a bottom-right grip. Its dimensions are a local user preference and are bounded to a sensible minimum that preserves the composer and a maximum within the active display work area. The conversation layout responds continuously: content owns available height, the message log scrolls independently, and the composer remains visible. Compact/mobile form factors use the same navigation state but no manual resize grip.

## Timeline

- time: "2026-08-15T05:36:06.637Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T05:36:06.637Z"
  kind: "evidence"
  summary: "User exploration, 2026-08-14: notifications should lead the popup; clicking one should enter a child chat view without dismissing the popup, using the existing team-dropdown-style back navigation. The child should show the log, a bottom composer, and a bottom-right responsive resize control. This is a proposal pending explicit design confirmation."
