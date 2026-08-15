---
id: "zoom-supports-managed-and-private-authorization"
kind: "requirement"
title: "Zoom supports managed and private authorization paths"
status: "superseded"
tags: ["zoom", "integration-authorization", "oauth", "settings"]
created_at: "2026-08-14T00:45:02.724Z"
updated_at: "2026-08-14T01:30:56.619Z"
---

# Zoom supports managed and private authorization paths

<!-- compiled_truth -->

Otto supports two Zoom connection methods selected in Integration settings: an Otto-managed browser sign-in as the default, and an advanced private Zoom-app connection path for users or deployments that provide their own app credentials. Neither path depends on the Zoom desktop client.

## Timeline

- time: "2026-08-14T00:45:02.724Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-platform","provider-neutral-communications-hub"]
- time: "2026-08-14T00:45:02.724Z"
  kind: "evidence"
  summary: "User confirmed 2026-08-13 that both authorization approaches should ultimately be supported and selectable."
- time: "2026-08-14T01:30:56.619Z"
  kind: "reversal"
  summary: "Superseded by explicit user direction on 2026-08-13 to drop the private Zoom-app authorization path entirely. New status: superseded."
