---
id: "zoom-titlebar-popups-have-no-bottom-shell-padding"
kind: "requirement"
title: "Zoom title-bar popups have no bottom shell padding"
status: "confirmed"
tags: ["zoom","title-bar","popup","spacing"]
created_at: "2026-08-15T05:09:48.737Z"
updated_at: "2026-08-21T04:50:58.883Z"
---
# Zoom title-bar popups have no bottom shell padding

<!-- compiled_truth -->

The Zoom Chat and Meeting Notes title-bar popup shells retain their 8px top inset and no outer bottom padding for their connected state. The Chat popup's empty (offline, no search field, no conversations) state is the one exception: its content gets bottom breathing room because there is no list below it to carry that spacing.

## Timeline

- time: "2026-08-15T05:09:48.737Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-favorites-are-native-starred-sessions","zoom-recorder-titlebar-transcript-library"]
- time: "2026-08-15T05:09:48.737Z"
  kind: "evidence"
  summary: "User explicitly requested removal of the observed bottom inset only from the Zoom popups. Inspection confirmed both popup shells used the same 8px vertical padding; changed each to top-only padding and verified formatting, lint, and app typecheck on 2026-08-14."
- time: "2026-08-21T04:50:58.883Z"
  kind: "decision"
  summary: "User reported (with screenshot of the Offline Chat popup, 2026-07-24) that the offline popup needs bottom padding while the connected one must not; refined the original blanket rule into a state-conditional one."
