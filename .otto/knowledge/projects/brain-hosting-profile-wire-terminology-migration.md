---
id: "brain-hosting-profile-wire-terminology-migration"
kind: "project"
title: "Brain prompt & template profile wire terminology migration"
status: "proposed"
tags: ["otto-brain", "protocol", "compatibility", "terminology"]
delivery_status: "charter"
created_at: "2026-08-13T07:40:38.354Z"
updated_at: "2026-08-13T07:40:38.354Z"
---

# Brain prompt & template profile wire terminology migration

<!-- compiled_truth -->

## Outcome

Evaluate and, if the compatibility cost is justified, rename the legacy `HostingProfile` wire and persisted identifiers to match the documented **Prompt & template profile** terminology.

## Constraints

- Preserve the protocol contract in both directions.
- Introduce only additive optional fields and tagged `COMPAT(...)` shims with a removal date.
- Do not rename `HostingProfile`, `hostingProfileId`, `hostingProfileMode`, or `familyHostingProfileIds` in place.
- Keep old persisted records readable and old clients able to parse new daemon messages.

## Acceptance criteria

- A written compat plan identifies each wire, persisted-store, and client impact before implementation.
- Old and new clients/daemons parse the transition payloads in either direction.
- The migration has a scheduled cleanup path after the supported compatibility window.

## Timeline

- time: "2026-08-13T07:40:38.354Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-13T07:40:38.354Z"
  kind: "evidence"
  summary: "Filed on 2026-08-13 while documenting the terminology collision. These names currently cross packages/protocol/src/messages.ts, so a direct rename would break the protocol contract."
