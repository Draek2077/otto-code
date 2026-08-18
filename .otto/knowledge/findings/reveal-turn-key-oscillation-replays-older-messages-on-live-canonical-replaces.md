---
id: "reveal-turn-key-oscillation-replays-older-messages-on-live-canonical-replaces"
kind: "finding"
title: "Reveal turn-key oscillation replays older messages on live canonical replaces"
status: "proposed"
tags: ["timeline", "reveal", "regression", "auto-speech", "two-path-delivery"]
created_at: "2026-08-18T03:31:31.490Z"
updated_at: "2026-08-18T03:31:31.490Z"
---

# Reveal turn-key oscillation replays older messages on live canonical replaces

<!-- compiled_truth -->

The "messages re-type over and over, not even the latest one" replay regression (introduced after a4d11cda2) is a turn-key oscillation in the TurnRevealTicker. The ticker's identity is the id of the last non-optimistic user_message (findTurnBoundary). That id is a derived id (createUniqueTimelineId: prefix_hash(text)\_timestamp + a suffix seeded by state.length), so it is NOT stable across the two delivery paths: the live WS projection assigns one id, and a canonical timeline replace (hydrateStreamState) re-derives ids from scratch. a4d11cda2 (30s grace, display cached state immediately + authoritative catch-up) moved canonical replaces onto the live visible surface, so the reveal's turnKey now flips (current turn -> rebuilt id of an OLDER turn -> back) on every replace page. Each flip hits the hard reset (revealed = target<=600 ? 0 : target) in update(), and a shrinking target re-clamps on the way back, so a settled/older reply re-types from 0 repeatedly. The reveal is a rendering cursor and the two paths legitimately disagree on derived ids, so the ticker must be robust to an oscillating turn-key: a target that shrinks under the last revealed position is a replace (snap to it), never a genuine new turn (which only ever grows from a small start).

## Timeline

- time: "2026-08-18T03:31:31.490Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["client-state-topology-and-chat-sync-invariants"]
- time: "2026-08-18T03:31:31.490Z"
  kind: "evidence"
  summary: "packages/app/src/agent-stream/turn-reveal.ts (TurnRevealTicker.update hard reset on turnKey change; findTurnBoundary last non-optimistic user_message; NEW_TURN_SNAP_THRESHOLD_CHARS=600); packages/app/src/types/stream.ts createUniqueTimelineId (suffixSeed = state.length); packages/app/src/timeline/session-stream-reducers.ts applyTimelineReplacePath (hydrateStreamState re-derives ids); a4d11cda2 viewed-timeline-sync grace 5s->30s."
