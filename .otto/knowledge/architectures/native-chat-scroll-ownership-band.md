---
id: "native-chat-scroll-ownership-band"
kind: "architecture"
title: "Native chat reader ownership is independent of passive resticking"
status: "proposed"
tags: ["chat-scrolling", "native", "mobile", "regression"]
created_at: "2026-08-10T21:12:08.644Z"
updated_at: "2026-08-10T21:12:08.644Z"
---

# Native chat reader ownership is independent of passive resticking

<!-- compiled_truth -->

Proposed: Native chat anchoring treats a reader drag as detached once it leaves the 8 px newest-message band. Android-only passive layout correction may use a separate 64 px band only while no user scroll is active; it must never turn a completed reader gesture into a snap back to the newest message. This preserves the transcript ownership rule across keyboard viewport changes.

## Timeline

- time: "2026-08-10T21:12:08.644Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-10T21:12:08.644Z"
  kind: "evidence"
  summary: "User report 2026-08-10: mobile chat scrolling works with the keyboard shown but frequently snaps back after it is dismissed. Code inspection traced the regression to commit 5745f3aab widening a shared native bottom-snap threshold from 64 px to 288 px. Implementation in packages/app/src/agent-stream/strategy-native.tsx now separates ownership (8 px) and passive resticking (64 px). Focused bottom-anchor-controller test, app typecheck, and targeted lint passed."
