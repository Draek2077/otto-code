---
id: "zoom-remote-daemon-device-authorization-proof-path"
kind: "architecture"
title: "Zoom remote-daemon proof path uses device authorization"
status: "superseded"
tags: ["zoom", "integration-authorization", "oauth", "remote-daemon"]
created_at: "2026-08-14T00:09:23.854Z"
updated_at: "2026-08-14T01:31:35.659Z"
---

# Zoom remote-daemon proof path uses device authorization

<!-- compiled_truth -->

For the private Zoom proof app, remote-daemon authorization should use Zoom Device Authorization rather than a loopback callback. The daemon initiates and polls the device flow; Desktop receives only the verification URL and user code. Confidential client provisioning remains a separate daemon-only requirement.

## Timeline

- time: "2026-08-14T00:09:23.854Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-platform","provider-neutral-communications-hub"]
- time: "2026-08-14T00:09:23.854Z"
  kind: "evidence"
  summary: "Zoom official OAuth documentation describes the device-code endpoint, verification URI, daemon-side polling token grant, and private-app limitation. Implementation primitives added in packages/server/src/server/integration-authorization/oauth-device.ts preserve device code and client credentials on the daemon side."
- time: "2026-08-14T01:31:35.659Z"
  kind: "reversal"
  summary: "Superseded by explicit user direction on 2026-08-13 to drop private Zoom-app/device authorization. Zoom will use Otto-managed browser sign-in only. New status: superseded."
