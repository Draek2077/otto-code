---
id: "remote-brain-functionality-is-host-owned-and-connection-neutral"
kind: "requirement"
title: "Remote Brain functionality is host-owned and connection-neutral"
status: "confirmed"
tags: ["brain", "remote", "client", "capabilities"]
created_at: "2026-08-09T03:37:01.390Z"
updated_at: "2026-08-09T03:37:01.390Z"
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
