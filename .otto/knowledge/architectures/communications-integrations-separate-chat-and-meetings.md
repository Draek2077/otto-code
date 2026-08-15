---
id: "communications-integrations-separate-chat-and-meetings"
kind: "architecture"
title: "Communication integrations separate chat from meetings"
status: "proposed"
tags: ["communications", "integration", "provider-neutral", "chat", "meetings", "transcription"]
created_at: "2026-08-13T22:30:38.419Z"
updated_at: "2026-08-15T05:14:18.176Z"
---

# Communication integrations separate chat from meetings

<!-- compiled_truth -->

Otto treats embedded communications as two independent extension families:

1. **Chat providers** are daemon-owned integrations for account-authorized conversation APIs. A Zoom Team Chat implementation is one provider. Authentication, polling/push behavior, threads, permissions, and message composition remain provider-specific behind that service boundary.
2. **Meeting capture providers** are host-local capture adapters plus local transcription. A Zoom desktop capture adapter is one provider. It is a capability of Otto Desktop’s privileged host runtime, never a second user-facing application.

The normal Otto installation contains the platform capture code. If Zoom and the daemon share a physical host, the daemon runs the adapter directly. If the daemon is remote, virtualized, or in WSL while Otto Desktop and Zoom run on the host OS, the Desktop runtime starts its bundled capture sidecar and opens a dedicated, least-privilege encrypted capture session to the remote daemon. Users install no additional companion or bridge application.

When a user has only VM-resident Otto instances but Zoom on the physical host, the product solution is a normal Otto Desktop frontend on that host connected to the chosen VM daemon. This improves the user’s primary workspace as well as enabling capture. Otto does not build or market a headless capture companion for that topology unless future evidence proves the normal host frontend is unsuitable.

The capture sidecar is internal process isolation, not product surface: it has no separate installer, icon, account, update channel, or general daemon authority. The Electron renderer never captures audio or holds host credentials.

The two families may share only stable, non-vendor concepts: paired-host security, transcript persistence/retention/audit, provider capability advertisement, and explicit bounded external-context attachments. They do not share OAuth, transport lifecycles, APIs, UI assumptions, recording state, or provider credentials.

Provider-neutral design means Zoom-specific code is isolated behind explicit `zoom` chat and `zoom-desktop` capture adapter identifiers, while transcript records use generic source metadata. Do not create a premature universal communications API: promote a shared abstraction only after a second provider proves the common behavior. New functionality remains capability-gated, with a provider’s unsupported features absent rather than simulated by brittle fallbacks.

## Timeline

- time: "2026-08-13T22:30:38.419Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-and-local-meeting-transcription","provider-neutral-capability-parity-defines-done"]
- time: "2026-08-13T22:30:38.419Z"
  kind: "evidence"
  summary: "User direction, 2026-08-13: Zoom is the initial proof case, but Otto must later support providers beyond Zoom. Meeting transcription and embedded chat do not need to share technology merely because both initially use Zoom."
- time: "2026-08-13T22:37:34.163Z"
  kind: "decision"
  summary: "The user established zero-install as the required default when the daemon and the meeting client share one physical host. The remote companion exists only for a daemon that cannot access the Zoom host."
  source: "User product requirement, 2026-08-13"
- time: "2026-08-13T22:41:39.846Z"
  kind: "decision"
  summary: "The user identified that the Zoom host will usually already run an Otto Desktop frontend. The remote-capture capability therefore belongs inside that frontend rather than a separately installed companion application."
  source: "User architecture decision, 2026-08-13"
- time: "2026-08-13T22:42:51.036Z"
  kind: "decision"
  summary: "The user judged the remaining no-frontend-on-Zoom-host case to be an undesirable deployment shape. Otto should solve it by giving the physical host a normal Otto Desktop frontend connected to the VM/remote daemon, not by building a separate capture companion."
  source: "User deployment direction, 2026-08-13"
- time: "2026-08-15T05:05:24.185Z"
  kind: "evidence"
  summary: "Integrations settings present independent Chat and Meetings sections. Each section has a global enablement switch that controls its matching title-bar icon, followed by an adapter selection. Zoom is the initial and only adapter for both sections; adapter-specific controls follow the selection."
  source: "Explicit user direction, 2026-08-14"
- time: "2026-08-15T05:12:26.036Z"
  kind: "evidence"
  summary: "The Adapter control is a right-aligned dropdown picker. Zoom is its only selectable option initially, and the adapter-specific controls below the picker render from the selected adapter."
  source: "Explicit user clarification, 2026-08-14"
- time: "2026-08-15T05:14:18.176Z"
  kind: "evidence"
  summary: "For Meetings, transcript delivery and local speech-model lifecycle are meeting-level settings, not Zoom adapter settings. The Adapter picker is the final row in the Meetings group, and no Zoom-specific Meeting adapter settings are rendered yet."
  source: "Explicit user correction, 2026-08-14"
