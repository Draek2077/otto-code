---
id: "provider-neutral-communications-hub"
kind: "project"
title: "Provider-neutral communications hub"
status: "proposed"
tags: ["communications", "zoom", "oauth", "notifications", "security"]
delivery_status: "in_build"
progress_completed: 2
progress_total: 7
progress_unit: "implementation slices"
created_at: "2026-08-13T23:03:27.629Z"
updated_at: "2026-08-14T00:26:52.011Z"
---

# Provider-neutral communications hub

<!-- compiled_truth -->

# Provider-neutral communications hub

## Outcome

Give Otto a daemon-owned communications capability that lets users read and send messages, intentionally add selected conversation detail to an AI workflow, and receive high-signal attention while coding. Zoom Team Chat is the first provider; meeting transcription remains a separate adapter family.

## Constraints

- Provider-neutral domain contracts, provider-specific adapters.
- Tokens, refresh state, OAuth verifier, and webhook secret are daemon-owned and never represented in client state or WebSocket payload schemas.
- Remote daemons and multiple connected frontends are first-class.
- No permanent Team Chat body mirror by default; explicit AI injection is consented and token-bounded.
- No separate desktop companion/installer. Native notifications while the Electron process remains resident are feasible; true OS notification after a fully quit application needs an additional persistent process or push service and must not be promised otherwise.
- PHI use requires an approved inbound-event/OAuth rendezvous path before a managed service handles live event payloads.

## Proposed v1

Build a host-scoped Communications hub with conversation list, current-conversation history, direct/channel compose, thread read, durable unread state, context selection, and one provider-neutral titlebar attention control. Use verified Zoom webhooks as the preferred delivery path and bounded reconciliation only on gaps/reconnects, never visible polling.

## Delivery gate

Do not commit to production UI until Zoom app distribution/review, public-client PKCE refresh behavior, Team Chat event subscriptions, managed ingress data handling, OS-grade secret storage, and cross-frontend notification-leasing are verified in an integration/security spike.

## Acceptance criteria

- An authorized Zoom user can send/read a channel or direct conversation from any Otto frontend attached to the owning daemon.
- No access/refresh token, verifier, authorization code, webhook secret, or chat body appears in renderer state, WS logs, daemon logs, config history, or project history by default.
- A Team Chat event produces exactly one daemon event and one notification lease across attached frontends; opening the conversation reconciles all clients.
- Selected messages only are formatted as bounded, source-labeled agent context.
- Disconnect deletes daemon credentials and local communication cache according to policy.

## Timeline

- time: "2026-08-13T23:03:27.629Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors","remote-brain","phi-vm-boundaries-require-encrypted-otto-transport"]
- time: "2026-08-13T23:03:27.629Z"
  kind: "evidence"
  summary: "Discovery proposal requested 2026-08-13. Evidence includes current Otto connector/OAuth and notification code, C:\\Users\\phili\\Projects\\zoom-companion-poc, and official Zoom OAuth, Chat API, Webhook, scope, rate-limit, and review documentation checked 2026-08-13."
- time: "2026-08-13T23:25:03.661Z"
  kind: "note"
  summary: "Implemented the first intentionally narrow foundation slice: a provider-neutral communications overview model, a daemon-global provider registry, the capability-gated communications.get_overview RPC, and a typed client entry point. No provider adapter, OAuth flow, UI, sending, or notification behavior has shipped."
  affects: ["provider-neutral-communications-hub"]
- time: "2026-08-13T23:32:15.321Z"
  kind: "note"
  summary: "Registered the Zoom Team Chat proof adapter in the daemon-global communications registry. The provider now reports its disconnected state through the neutral overview RPC. OAuth remains deliberately unimplemented pending a daemon-grade secret-store design and review."
  affects: ["provider-neutral-communications-hub"]
- time: "2026-08-14T00:26:52.011Z"
  kind: "note"
  summary: "Added the Zoom Team Chat REST adapter as a daemon-only proof-provider boundary. It uses an injected access-token supplier, bounds list pages to 50, requires exactly one conversation target for reads and sends, and deliberately omits provider error response bodies from errors. It is not yet attached to fetching, persistence, or UI."
  affects: ["provider-neutral-communications-hub"]
