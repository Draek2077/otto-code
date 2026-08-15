---
id: "phi-vm-boundaries-require-encrypted-otto-transport"
kind: "requirement"
title: "PHI VM boundaries require encrypted Otto transport"
status: "confirmed"
tags: ["security", "phi", "transport", "vm", "tls"]
created_at: "2026-08-13T22:47:18.967Z"
updated_at: "2026-08-13T22:52:39.272Z"
---

# PHI VM boundaries require encrypted Otto transport

<!-- compiled_truth -->

A VM running an Otto daemon is a security boundary when it holds PHI, even if the Otto Desktop frontend and VM share physical hardware. Host-to-VM Otto traffic, including capture transcript delivery, must use encrypted and authenticated transport.

The supported direct shape is a trusted TLS terminator in the VM forwarding WebSocket upgrades to a loopback-only daemon. For fast self-managed development, this may use a VM-side private CA (for example, Caddy’s internal PKI) and a private hostname. The authorized physical host installs only that CA’s public root certificate in its OS trust store, verifies the root fingerprint through an independent VM-console/admin channel, then connects using Add Host with Use SSL enabled and separate Otto authentication. Firewall rules permit only the physical host to reach the VM TLS listener; the raw daemon port remains unreachable outside the VM.

A self-signed leaf certificate that the client accepts without validation, an “ignore certificate errors” switch, plain WebSocket, bearer-only authentication, or host-only/NAT/LAN/WSL forwarding are not acceptable substitutes. Production PHI deployments should use the organization’s managed private PKI and access controls rather than per-developer trust roots.

Otto’s end-to-end relay is an alternative encrypted transport, but its metadata exposure and service/compliance posture must be approved for PHI deployments.

## Timeline

- time: "2026-08-13T22:47:18.967Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-and-local-meeting-transcription","communications-integrations-separate-chat-and-meetings"]
- time: "2026-08-13T22:47:18.967Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-13: Otto Desktop on the physical host communicates with daemons in VMs that must remain separated for PHI. That host-to-VM connection must be encrypted even though the machines share physical hardware. Current code inspection confirms Add Host supports a Use SSL toggle and password, but UI copy specifies SSL is only for a daemon behind a TLS terminator; docs/docker.md gives the Caddy/Nginx reverse-proxy model."
- time: "2026-08-13T22:52:39.272Z"
  kind: "decision"
  summary: "The user chose a VM-side self-managed certificate path rather than Tailscale. The requirement now distinguishes a trusted private CA from an insecure certificate exception."
  source: "User deployment direction, 2026-08-13; Caddy internal-PKI documentation checked 2026-08-13"
