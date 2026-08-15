---
id: "communications-popup-notifications-are-a-root-section"
kind: "requirement"
title: "Communications popup notifications remain a root section"
status: "confirmed"
tags: ["communications", "zoom", "notifications", "title-bar", "popup", "chat"]
created_at: "2026-08-15T05:40:52.903Z"
updated_at: "2026-08-15T06:17:10.519Z"
---

# Communications popup notifications remain a root section

<!-- compiled_truth -->

The Communications popup keeps its existing root layout: Notifications is a section above Favorites and other chat sections, not a replacement landing view. Selecting a notification, a conversation in any root section, or a search result enters that conversation in a child view within the persistent popup.

Entering a conversation marks its notification read and removes that notification from the root section. A user may also dismiss one notification or clear all notifications without opening conversations. Dismissal is a notification-state action; it must not claim a remote Team Chat message was read unless the provider exposes and Otto performs a true mark-read operation.

## Timeline

- time: "2026-08-15T05:40:52.903Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T05:40:52.903Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14: the current popup layout remains valid; notifications stay as the section above Favorites. Opening a notification, selecting a chat from search, or otherwise navigating to that chat removes its notification. Notifications can also be individually dismissed or cleared all."
- time: "2026-08-15T06:17:10.519Z"
  kind: "evidence"
  summary: "Added daemon-local notification acknowledgement derived from provider-reported unread conversation counts. Opening, dismissing, and clearing cards only update Otto's local inbox projection; this implementation does not invoke or claim a provider mark-read mutation. The popup retains its Chat Home root while the room is opened in a child page."
  source: "Implementation and focused verification, 2026-08-14"
