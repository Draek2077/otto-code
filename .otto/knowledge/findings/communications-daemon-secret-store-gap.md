---
id: "communications-daemon-secret-store-gap"
kind: "finding"
title: "Communications daemon secret-store gap"
status: "proposed"
tags: ["communications", "zoom", "oauth", "security", "secrets"]
created_at: "2026-08-13T23:32:14.416Z"
updated_at: "2026-08-13T23:32:14.416Z"
---

# Communications daemon secret-store gap

<!-- compiled_truth -->

The current daemon codebase has no reusable OS/keychain-grade secret-store implementation for a remote-hosted communications integration. Existing connector OAuth state is persisted in daemon configuration, which is redacted over the wire but is not a suitable storage contract for Zoom refresh tokens under the communications security requirement. Zoom OAuth connection must remain disabled until a daemon-grade secret-store adapter is implemented and reviewed.

## Timeline

- time: "2026-08-13T23:32:14.416Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-communications-hub","phi-vm-boundaries-require-encrypted-otto-transport"]
- time: "2026-08-13T23:32:14.416Z"
  kind: "evidence"
  summary: "Source inspection, 2026-08-13: no keytar, safeStorage, libsecret, Credential Manager, or reusable secret-store implementation found under packages/ after searching source and manifests. Existing connector OAuth tokens are modeled in packages/protocol/src/provider-config.ts and persisted through packages/server/src/server/daemon-config-store.ts."
