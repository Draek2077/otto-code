---
id: "zoom-uses-otto-managed-authorization-only"
kind: "requirement"
title: "Zoom uses Otto-managed authorization only"
status: "confirmed"
tags: ["zoom", "integration-authorization", "oauth", "settings"]
created_at: "2026-08-14T01:30:52.305Z"
updated_at: "2026-08-14T04:33:09.676Z"
---

# Zoom uses Otto-managed authorization only

<!-- compiled_truth -->

Zoom Team Chat supports one connection path: Otto-managed browser sign-in. Otto does not support a user-provided/private Zoom app authorization path, and the Zoom desktop client is not involved.

## Timeline

- time: "2026-08-14T01:30:52.305Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-supports-managed-and-private-authorization","integration-authorization-platform","provider-neutral-communications-hub"]
- time: "2026-08-14T01:30:52.305Z"
  kind: "evidence"
  summary: "User direction, 2026-08-13: “scratch [Use my Zoom app] entirely… Sign in with Zoom we definitely need to figure out.”"
- time: "2026-08-14T04:33:09.676Z"
  kind: "evidence"
  summary: "End-to-end Zoom Team Chat OAuth succeeded in the isolated Otto Desktop development lane. Zoom returned through the loopback callback, the daemon exchanged the PKCE code, and the token set persisted securely after the Windows Credential Manager adapter began chunking oversized opaque credential values. No user-managed Zoom app, work-account developer access, plaintext fallback, or token logging was required."
  source: "Dev validation on 2026-08-13"
  affects: ["integration-authorization-is-daemon-owned-and-reusable"]
