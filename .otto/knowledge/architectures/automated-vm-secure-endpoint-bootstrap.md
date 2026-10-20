---
id: "automated-vm-secure-endpoint-bootstrap"
kind: "architecture"
title: "Automated VM secure endpoint bootstrap"
status: "proposed"
tags: []
created_at: "2026-08-13T22:55:44.939Z"
updated_at: "2026-08-13T22:55:44.939Z"
---

# Automated VM secure endpoint bootstrap

<!-- compiled_truth -->

Explore a VM-focused Otto daemon install mode that declares its reverse-proxy dependency through Debian package metadata, keeps the daemon loopback-only, provisions a Caddy private-CA TLS endpoint automatically, and pairs a physical-host Otto Desktop to that endpoint. IP may locate the VM but secure enrollment must include independent fingerprint or pairing-code verification; IP alone cannot establish VM identity.

## Timeline

- time: "2026-08-13T22:55:44.939Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["phi-vm-boundaries-require-encrypted-otto-transport","communications-integrations-separate-chat-and-meetings"]
- time: "2026-08-13T22:55:44.939Z"
  kind: "evidence"
  summary: "User asked whether Otto's .deb can install the needed apt tools and configure Caddy without manual configuration beyond the VM IP. Design discussion establishes that VM-host PHI traffic needs encrypted, authenticated transport."
