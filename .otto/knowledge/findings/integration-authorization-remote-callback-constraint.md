---
id: "integration-authorization-remote-callback-constraint"
kind: "finding"
title: "Remote daemon OAuth callbacks cannot assume local loopback"
status: "proposed"
tags: ["integration-authorization", "oauth", "remote-daemon", "security"]
created_at: "2026-08-14T00:03:39.263Z"
updated_at: "2026-08-14T00:09:22.829Z"
---

# Remote daemon OAuth callbacks cannot assume local loopback

<!-- compiled_truth -->

A daemon-owned OAuth flow cannot use a loopback redirect as its universal callback transport when the browser and daemon can run on different machines. Sending authorization codes over Otto WebSocket is excluded by the daemon-owned-secret boundary.

## Timeline

- time: "2026-08-14T00:03:39.263Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-platform","provider-neutral-communications-hub"]
- time: "2026-08-14T00:03:39.263Z"
  kind: "evidence"
  summary: "Verified 2026-08-13 while designing the reusable PKCE core. RFC-style loopback redirects target the browser machine, so a Desktop attached to a remote daemon would direct the callback to the wrong host. The existing connector OAuth broker uses loopback only for host-local connectors. Zoom public-client PKCE is documented by Zoom, but its callback transport must be selected explicitly for remote-daemon Otto."
- time: "2026-08-14T00:09:22.829Z"
  kind: "evidence"
  summary: "2026-08-13: Zoom documents Device Authorization for General apps: the daemon requests a device code, the user authorizes via verification URI, and the daemon polls Zoom directly for tokens. This avoids a redirect callback and keeps the device code, client secret, and tokens off Otto WebSocket. Zoom documents it as requiring Basic client credentials and says the feature is currently only available for private app types."
  source: "Zoom OAuth documentation"
