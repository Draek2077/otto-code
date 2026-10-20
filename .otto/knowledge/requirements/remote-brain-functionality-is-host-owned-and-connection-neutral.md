---
id: "remote-brain-functionality-is-host-owned-and-connection-neutral"
kind: "requirement"
title: "Remote Brain functionality is host-owned and connection-neutral"
status: "confirmed"
tags: ["brain","remote","client","capabilities"]
created_at: "2026-08-09T03:37:01.390Z"
updated_at: "2026-08-22T02:25:36.000Z"
---
# Remote Brain functionality is host-owned and connection-neutral

<!-- compiled_truth -->

A Brain page connected through a daemon that proxies a configured remote brain must expose the same host-owned information and operations as a direct connection to the daemon that owns that brain. Remote restart is available only when the brain advertises it and permits remote configuration; start and stop remain daemon-owned. Runtime and model-storage information come from the brain host, and model storage is shown against total and free host filesystem capacity.

## Timeline

- time: "2026-08-09T03:37:01.390Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T03:37:01.390Z"
  kind: "evidence"
  summary: "User direction on 2026-08-08; implemented through the brain management API, daemon proxy, and Brain page."
- time: "2026-08-22T01:29:58.961Z"
  kind: "evidence"
  summary: "Brain Overview Runtime now prefers the runtime identity carried by the Brain host status, so a remote Brain is not judged by the connected daemon's local runtime config or inventory. The protocol declares the additive `runtime` status field, and focused runtime-management coverage verifies installed and `not installed` host states."
  source: "Implementation and focused regression coverage, 2026-08-21"
  affects: ["remote-brain"]
- time: "2026-08-22T01:40:03.469Z"
  kind: "evidence"
  summary: "Remote runtime management now reconciles the dialog with the Brain host’s live runtime identity and inventory rather than the proxy daemon’s local runtime configuration. The action is unavailable unless a remote Brain both responds with runtime state and advertises writable remote configuration; when permitted, runtime-install jobs continue through the host-owned daemon-to-Brain route."
  source: "Implementation and focused regression coverage, 2026-08-21"
  affects: ["remote-brain"]
- time: "2026-08-22T02:25:36.000Z"
  kind: "evidence"
  summary: "Brain model-process configuration is connection-neutral: the owning daemon persists and applies `maxLoadedModels` and `lockedModels`, advertises the additive process-pool capability, and the same Settings surface edits these fields locally or through the remote Brain config route. The default remains one auto-loaded model; a locked set may preload up to the configured process limit."
  source: "User direction and verified implementation, 2026-08-21"
  affects: ["brain-managed-process-pool","remote-brain"]
