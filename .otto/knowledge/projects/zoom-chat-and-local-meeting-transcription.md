---
id: "zoom-chat-and-local-meeting-transcription"
kind: "project"
title: "Zoom Chat and Local Meeting Transcription"
status: "proposed"
tags: ["zoom", "integration", "local-first", "privacy", "chat", "transcription"]
delivery_status: "charter"
progress_completed: 0
progress_total: 6
progress_unit: "delivery phases"
created_at: "2026-08-13T22:04:33.611Z"
updated_at: "2026-08-14T16:30:10.261Z"
---

# Zoom Chat and Local Meeting Transcription

<!-- compiled_truth -->

# Outcome

Otto proves two separate Zoom capabilities:

1. **Zoom Chat** is a daemon-owned embedded Team Chat companion for the signed-in user's own Zoom account.
2. **Zoom Meetings** captures and transcribes on the physical Windows/Linux host where Zoom runs. Audio is ephemeral after local transcription; the completed transcript is durable daemon-managed data with retention and deletion controls.

Zoom is the initial proof case. See [[communications-integrations-separate-chat-and-meetings]] for the provider-neutral boundary.

## One-product deployment model

- The normal Otto installation includes meeting-capture support. There is no separate companion application, installer, icon, account, or update channel.
- When Zoom and the daemon share a host, the daemon runs the compatible `zoom-desktop` capture adapter directly. The Desktop frontend provides controls and status.
- When Zoom and Otto Desktop run on the host OS but the daemon is remote, virtualized, or in WSL, Otto Desktop’s privileged host runtime starts its bundled capture sidecar. It transcribes locally and uses a dedicated, least-privilege encrypted capture session to deliver the transcript to the daemon.
- The capture sidecar is an internal process boundary for native OS access and recovery. It is not renderer JavaScript and does not receive general Otto authority, workspaces, agent/provider credentials, or a standalone UI.
- A headless capture deployment is deferred. If a future topology lacks Otto Desktop on the Zoom host, it must reuse this same protocol and ship through the normal Otto distribution, not become a separate product.

## Security and data lifecycle

- Same-host capture never crosses a machine boundary before daemon persistence.
- For remote daemon operation, the bundled capture sidecar establishes a dedicated device identity and a narrow `transcript ingest and capture control` grant. It uses Otto’s authenticated end-to-end relay or direct authenticated TLS with pinned daemon identity. Plain WebSocket, bearer-only authentication, and a LAN-open daemon are unacceptable for transcript traffic.
- Chunks are authenticated, ordered, bounded, idempotent, and acknowledged by durable transcript revision. The sidecar deletes temporary audio only after final acknowledgement, with a configurable recovery window. Audio is never uploaded.
- The daemon encrypts transcript text at rest under a dedicated access boundary and excludes it from logs, diagnostics, crash reports, generic workspace files, and unbounded agent history.
- Stored transcripts never enter model context automatically. **Add to chat** is an explicit, bounded disclosure that names source, selected time range, and destination provider.
- End-to-end encryption protects transit against observers and an untrusted relay. Operators must still verify daemon hosting, model-provider eligibility, data residency, controls, and applicable BAAs before enabling transcript forwarding or Add to chat.

## Delivery sequence

1. Recover and assess the recorder prototype: capture mechanism, dependencies, local model/runtime, Windows/Linux support, lifecycle, licensing, and tests.
2. Implement same-host daemon capture and daemon transcript storage first: zero-install local transcription, encryption at rest, retention/deletion, and explicit Add to chat.
3. Add the bundled Desktop capture sidecar for remote-daemon, VM, and WSL topologies: device identity, least privilege, E2E transport, resumable ingestion, revocation, and audit records.
4. Promote the Chat POC into a daemon-owned Zoom client with safe OAuth, scopes, pagination, cancellation, rate limits, and redacted observability.
5. Ship Chat and Meetings surfaces with source-specific Add to chat and robust loading/error/empty/accessibility behavior.
6. Validate local, remote daemon, VM, and WSL topologies; Windows/Linux; real Zoom accounts; reconnection/resume; key loss/revocation; tamper/replay; security; and compliance review.

## Acceptance criteria

- On a compatible Zoom host, users have meeting transcription through Otto alone, with no additional application installation.
- The Desktop runtime can provide capture securely to a remote daemon without turning the frontend into a general-purpose daemon client.
- No audio is uploaded; temporary audio is deleted only after durable transcript acknowledgement.
- Transcripts are encrypted in transit and at rest, excluded from diagnostics, and managed through daemon retention/deletion/audit controls.
- Transcript and Zoom Chat content enter model context only through explicit, bounded Add to chat selection.
- Unsupported provider/capture features are capability-gated, never simulated by legacy fallbacks.

## Open gates

- Recorder source, licensing, and a cross-platform capture/transcription evaluation.
- Security review of the Desktop-sidecar identity, OS key storage, relay/direct-TLS modes, at-rest encryption, and key management.
- Compliance approval for the concrete Zoom, daemon-hosting, and model-provider/BAA configuration.
- Real-account validation of the Chat POC's scopes, limits, OAuth behavior, and distribution requirements.

## Timeline

- time: "2026-08-13T22:04:33.611Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T22:04:33.611Z"
  kind: "evidence"
  summary: "User request (2026-08-13) identifies two prototypes: zoom-recorder for local Windows/Linux Zoom recording and automatic transcription, and zoom-companion-poc for a signed-in user's Zoom Team Chat. Read-only inspection found zoom-companion-poc at C:\\Users\\phili\\Projects\\zoom-companion-poc; its source implements loopback PKCE, user-level channels/contacts/messages and rate-limit reporting. The named zoom-recorder directory was absent from the available filesystem. Zoom's official OAuth documentation (checked 2026-08-13) confirms public-client PKCE without a client secret; Zoom Chat API documentation confirms account and scope constraints."
- time: "2026-08-13T22:14:01.823Z"
  kind: "decision"
  summary: "The user clarified the required topology: Zoom runs on a physical host OS even when the Otto daemon is remote or virtualized. The recorder therefore cannot be daemon-owned; it needs a host-local control and capture service. Zoom Chat does not require a Zoom desktop client and remains daemon-owned."
  source: "User architecture clarification, 2026-08-13"
- time: "2026-08-13T22:29:42.543Z"
  kind: "decision"
  summary: "The user decided that audio is ephemeral after local transcription and that completed transcripts are durable daemon-managed data, available through Otto frontends. Because this crosses from a non-Otto Zoom Host Agent to a potentially remote daemon and may carry protected health information, the design now requires secure host pairing and end-to-end encrypted transit."
  source: "User security and retention direction, 2026-08-13"
- time: "2026-08-13T22:30:43.480Z"
  kind: "evidence"
  summary: "The user clarified that Zoom is the initial proof case, not the permanent product boundary. Embedded chat and local meeting transcription are separate provider-extension families. See [[communications-integrations-separate-chat-and-meetings]]."
  source: "User direction, 2026-08-13"
  affects: ["communications-integrations-separate-chat-and-meetings"]
- time: "2026-08-13T22:38:04.533Z"
  kind: "decision"
  summary: "The user established zero-install as the required same-host experience. When the daemon and Zoom share one physical host, capture must run as a native daemon capability; the independently installed companion is only for remote/virtualized daemon topologies."
  source: "User product requirement, 2026-08-13"
- time: "2026-08-13T22:42:02.945Z"
  kind: "decision"
  summary: "The user decided that, in the common remote-daemon topology, Otto Desktop already runs on the Zoom host. Meeting capture must therefore be a built-in frontend capability rather than a separately installed companion utility."
  source: "User architecture decision, 2026-08-13"
- time: "2026-08-13T22:43:06.896Z"
  kind: "evidence"
  summary: "The user identified the only likely no-host-frontend case as VM-resident Otto with Zoom on the physical host, and chose the product solution: run a normal Otto Desktop frontend on that host connected to the VM daemon. A headless capture companion is not part of this initiative. See [[communications-integrations-separate-chat-and-meetings]]."
  source: "User deployment direction, 2026-08-13"
  affects: ["communications-integrations-separate-chat-and-meetings"]
- time: "2026-08-14T16:30:10.261Z"
  kind: "evidence"
  summary: "Fixed Desktop Zoom Recorder quit lifecycle: recorder watcher/download subprocesses now stop as a bounded awaited quit phase before the managed daemon stops, and the status polling timer is cleared. This prevents an Electron quit from leaving `otto-zoom-recorder.exe` orphaned. Focused lifecycle and recorder shutdown tests, desktop lint, and desktop typecheck passed."
  source: "Focused implementation and verification, 2026-08-14."
  affects: ["zoom-recorder-is-desktop-host-local-only"]
