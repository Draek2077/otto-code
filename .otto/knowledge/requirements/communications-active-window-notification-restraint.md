---
id: "communications-active-window-notification-restraint"
kind: "requirement"
title: "Communications active-window notification restraint"
status: "confirmed"
tags: ["communications", "notifications", "zoom", "titlebar"]
created_at: "2026-08-13T23:15:35.145Z"
updated_at: "2026-08-13T23:15:35.145Z"
---

# Communications active-window notification restraint

<!-- compiled_truth -->

When an Otto frontend is active, incoming communications must not produce native desktop notifications, banners, toast alerts, sounds, accessibility escalation, or other intrusive in-app alerts. The communications icon in the Otto title bar, with a compact unread badge and visual state, is the sole active-window notifier. Existing desktop-notification accessibility behavior remains unchanged.

## Timeline

- time: "2026-08-13T23:15:35.145Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-communications-hub"]
- time: "2026-08-13T23:15:35.145Z"
  kind: "evidence"
  summary: "User decision, 2026-08-13: \"I never wanted the notifications to be any more accessible than the ones we have now. And when in-app i dont want them at all, i want only the in-app notifications which we will use the icon itself in the title as the notifier.\""
