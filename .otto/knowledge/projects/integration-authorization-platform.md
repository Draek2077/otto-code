---
id: "integration-authorization-platform"
kind: "project"
title: "Integration Authorization Platform"
status: "proposed"
tags: ["integrations", "oauth", "sso", "security", "credentials"]
delivery_status: "in_build"
progress_completed: 6
progress_total: 7
progress_unit: "implementation slices"
created_at: "2026-08-13T23:34:37.185Z"
updated_at: "2026-08-14T02:02:33.074Z"
---

# Integration Authorization Platform

<!-- compiled_truth -->

# Outcome

Create one daemon-owned authorization platform for every Otto integration, starting with connectors and Zoom Team Chat. It is a host capability, not Otto user-account SSO.

## Product boundary

- Settings says **Connect** or **Reconnect**, not “paste OAuth token.”
- OAuth/SSO, API key, and later device-code authorization are methods beneath one integration lifecycle.
- The daemon alone owns authorization state, callback handling, refresh, revocation, and secrets.
- Frontends receive only safe connection metadata and initiate typed authorization actions. They never receive authorization codes, access tokens, refresh tokens, client secrets, or vault values.
- Zoom Team Chat and meeting transcription remain separate adapter families. They share this authorization platform only where both need an external identity.

## Architecture

### 1. Integration catalog and metadata

Each integration declares an ID, label, authorization method, requested scopes, connection capabilities, and callback requirements. Persist only nonsecret metadata:

```ts
interface IntegrationConnectionMetadata {
  integrationId: string;
  connectionId: string;
  method: "oauth-pkce" | "api-key";
  state: "disconnected" | "authorizing" | "connected" | "reauth_required" | "error";
  accountLabel: string | null;
  grantedScopes: string[];
  updatedAt: string;
  errorCode: string | null;
}
```

This metadata can be sent to connected clients and used to render settings/inbox state. It must not include secret material.

### 2. Host Credential Vault

A daemon-local `CredentialVault` stores opaque secret blobs by a stable key derived from daemon identity, integration ID, and connection ID. Its only operations are `get`, `put`, `delete`, and `availability`.

The first production backend should use a maintained Node N-API OS-keyring binding. Do **not** use Electron `safeStorage` as the primary solution: the daemon can be remote and runs without Electron. Do **not** fall back to `config.json`, renderer-local storage, or an encrypted file with a co-located key.

On hosts without a secure store, authorization fails closed with a clear “secure credential storage is unavailable on this host” state. Headless Linux/VM support must be proved against the actual daemon deployment target before OAuth is offered.

### 3. Authorization broker

`IntegrationAuthorizationService` owns all connection lifecycles:

- start authorization
- expose a browser URL only when the daemon owns a reachable callback path
- consume callback and verify state/PKCE
- exchange, refresh, rotate, revoke, and erase credentials through the vault
- publish sanitized connection-state changes to all attached frontends

Provider implementations are small `AuthorizationDriver` adapters. Zoom is one driver; connector OAuth is migrated to this broker rather than maintained as a parallel token store.

### 4. Redirect topology

The authorization code must go directly from browser to a daemon-owned callback endpoint over HTTPS. A remote daemon therefore needs a configured, reachable public callback URL. Loopback callback is allowed only when the daemon itself is local to the browser.

Relay-only and headless topologies do not get a hidden renderer or WebSocket code-forwarding path. They remain unavailable until a separate encrypted callback relay is designed and reviewed.

## Protocol

Capability gate: `server_info.features.integrationAuthorization`.

- `integrations.authorization.list.request/response`
- `integrations.authorization.start.request/response`
- `integrations.authorization.disconnect.request/response`
- pushed `integrations.authorization.changed`

Responses contain only `IntegrationConnectionMetadata`; the authorization URL is a short-lived public URL, never a credential. Browser-open is frontend-owned after the daemon response.

## Migration

1. Build and test the vault abstraction with an explicit unavailable state.
2. Add metadata registry + broker and safe wire contracts.
3. Migrate existing connector OAuth state out of daemon config, retaining a read-only migration path only long enough to move/revoke legacy tokens.
4. Implement Zoom PKCE on the broker.
5. Add API-key connection method through the same vault, then migrate settings surfaces incrementally.

## Acceptance criteria

- A client can never read or write a secret-bearing config field through a normal settings patch.
- A remote client only sees status/account/scopes and can never receive callback code or tokens.
- OAuth is unavailable, rather than insecure, when the daemon lacks a secure vault or callback endpoint.
- A new integration supplies a descriptor and driver, not a settings-specific OAuth implementation.
- Connector OAuth and Zoom each use the same broker and vault before the platform is considered shipped.

## Timeline

- time: "2026-08-13T23:34:37.185Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors","provider-neutral-communications-hub","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-13T23:34:37.185Z"
  kind: "evidence"
  summary: "Repository inspection, 2026-08-13: connector OAuth currently uses ConnectorOAuthBroker and daemon config. `packages/server/src/server/daemon-config-store.ts` redacts client wire data but persists config. Zoom and remote-daemon constraints require a host-owned secret vault and daemon callback topology."
- time: "2026-08-13T23:40:48.093Z"
  kind: "note"
  summary: "Implemented the first reusable core: shared wire-safe connection metadata, an atomic daemon-local metadata registry, a fail-closed CredentialVault interface, and IntegrationAuthorizationService. Zoom Team Chat now consumes this service for its connection-state projection. No native vault backend, OAuth driver, callback endpoint, or settings UI has shipped."
  affects: ["integration-authorization-platform"]
- time: "2026-08-13T23:47:51.207Z"
  kind: "note"
  summary: "Implemented the fail-closed credential-vault contract and native OS-keyring backend. Integration connection metadata remains in daemon-local JSON without tokens; secrets are keyed by host/integration/connection in the daemon OS vault. Windows Credential Manager loading and write/read/delete were verified with a self-cleaning probe."
  affects: ["integration-authorization-platform"]
- time: "2026-08-13T23:55:32.030Z"
  kind: "note"
  summary: "Added a capability-gated integrations.authorization.get_overview RPC and client method. It exposes only OS-vault availability plus sanitized daemon-owned connection metadata, so future settings surfaces can reuse one authorization state model without receiving credentials or callback material."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T00:03:40.351Z"
  kind: "note"
  summary: "Implemented and tested a provider-neutral OAuth PKCE core: S256 verifier/challenge creation, authorization URL generation, confidential-data-free public-client token exchange, refresh support, and error redaction. The pending verifier remains in daemon memory only. Remote callback transport remains an explicit next design decision rather than defaulting to an invalid loopback path."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T00:09:24.866Z"
  kind: "note"
  summary: "Added a provider-neutral OAuth Device Authorization primitive for remote-daemon flows. It creates a safe browser prompt, keeps device codes and confidential client credentials daemon-only, handles pending/denied/expired polling states without response-body leakage, and returns tokens only to the daemon caller. Zoom’s private-app limitation and client-credential provisioning dependency are recorded."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T00:36:12.676Z"
  kind: "note"
  summary: "Added daemon-vault OAuth token-set persistence and the Zoom access-token supplier. Tokens and refresh credentials remain a single opaque keyring value; only connected state, account label, and scopes reach metadata. The Zoom supplier refuses tokens within its refresh skew window rather than placing an expiring bearer token on a REST request. Server build, targeted tests, lint, and server typecheck pass."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T00:53:26.089Z"
  kind: "note"
  summary: "Implemented the daemon-owned authorization-method catalog and capability-gated get_methods RPC/client contract. Zoom declares both the recommended managed PKCE sign-in path and the advanced private-app device-authorization path as planned, and the contract never exposes credentials. Targeted tests, server-stack build, lint, and full workspace typecheck pass."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T01:32:40.510Z"
  kind: "note"
  summary: "Removed the unused Zoom private-app/device-authorization path after the product decision to support Otto-managed Zoom sign-in only. Zoom’s catalog now exposes one planned PKCE method; all focused tests and full workspace typecheck pass."
  affects: ["integration-authorization-platform"]
- time: "2026-08-14T02:02:33.074Z"
  kind: "note"
  summary: "Implemented the Otto-managed Zoom PKCE broker, explicit daemon configuration gate, unauthenticated callback route with daemon-side state verification, and capability-gated start_authorization RPC. The browser receives only an authorization URL; PKCE verifier and token exchange remain daemon-owned. Focused tests, full daemon build, lint, and full workspace typecheck pass."
  affects: ["integration-authorization-platform"]
