---
id: "reference-napi-rs-keyring"
kind: "reference"
title: "@napi-rs/keyring"
status: "proposed"
tags: ["integration-authorization", "security", "daemon"]
reference_disposition: "dependency"
source_url: "https://github.com/Brooooooklyn/keyring-node"
created_at: "2026-08-13T23:47:49.977Z"
updated_at: "2026-08-13T23:47:49.977Z"
---

# @napi-rs/keyring

<!-- compiled_truth -->

Native N-API binding to the operating-system credential store. Otto uses it only in the daemon credential-vault adapter, never in the renderer or over WebSocket.

## Timeline

- time: "2026-08-13T23:47:49.977Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-platform"]
- time: "2026-08-13T23:47:49.977Z"
  kind: "evidence"
  summary: "Verified against installed v1.3.0 package metadata and declarations: it provides synchronous Entry set/get/delete methods and platform-specific optional binaries. A self-cleaning Windows Credential Manager write/read/delete probe passed on 2026-08-13."
