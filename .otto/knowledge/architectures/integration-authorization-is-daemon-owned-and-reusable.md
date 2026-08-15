---
id: "integration-authorization-is-daemon-owned-and-reusable"
kind: "architecture"
title: "Integration authorization is daemon-owned and reusable"
status: "confirmed"
tags: ["integrations", "oauth", "sso", "security", "connectors"]
created_at: "2026-08-13T23:34:36.180Z"
updated_at: "2026-08-15T00:59:54.448Z"
---

# Integration authorization is daemon-owned and reusable

<!-- compiled_truth -->

Otto uses one daemon-owned Integration Authorization platform for settings surfaces that connect external services. OAuth/SSO, API keys, and later authorization methods are credential methods within that platform, not bespoke settings implementations or provider-specific token paths. Connection status and nonsecret metadata can reach clients; authorization codes, access tokens, refresh tokens, client secrets, and vault material must never be placed in renderer state or WebSocket payloads.

## Timeline

- time: "2026-08-13T23:34:36.180Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors","provider-neutral-communications-hub"]
- time: "2026-08-13T23:34:36.180Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-13: settings surfaces requiring SSO login must share one reusable system for connectors and adapters."
- time: "2026-08-13T23:40:48.961Z"
  kind: "evidence"
  summary: "Implemented `packages/protocol/src/integration-authorization.ts` plus daemon `CredentialVault`, file-backed metadata registry, and IntegrationAuthorizationService. Zoom Team Chat derives its safe connection state from the shared service. Tests prove secret values stay out of the metadata file and unavailable vault writes fail closed; targeted tests, lint, and full workspace typecheck passed."
  source: "Implementation verification, 2026-08-13"
  affects: ["integration-authorization-platform","provider-neutral-communications-hub"]
- time: "2026-08-14T02:58:53.273Z"
  kind: "evidence"
  summary: "Zoom Team Chat now uses Otto's registered public PKCE client with the fixed loopback redirect `http://127.0.0.1:6872/integrations/zoom-team-chat/oauth/callback`. The daemon temporarily owns that listener, validates state and PKCE, expires abandoned attempts after ten minutes, stores tokens only through the credential vault, and refreshes expiring tokens through the same public client. Settings exposes only nonsecret state and the browser sign-in action. Focused OAuth/token/provider tests, lint, and full workspace typecheck passed."
  source: "Implementation verification, 2026-08-13"
  affects: ["zoom-uses-otto-managed-authorization-only","communications-prove-then-expand"]
- time: "2026-08-15T00:09:48.052Z"
  kind: "evidence"
  summary: "Zoom Team Chat Settings must show the actual authorized account email, enabling deliberate testing and switching between draekz@gmail.com and philippe.durand@curvedental.com. OAuth recovery must never require closing a browser or its tabs: a fresh sign-in replaces only Otto's pending callback listener and verifier; stale browser callbacks cannot cancel the replacement attempt. A persisted authorizing state alone must not cause automatic polling or disable Sign in after browser/desktop restart."
  source: "User direction and implementation validation, 2026-08-14"
  affects: ["zoom-settings-and-titlebar-entrypoints","zoom-uses-otto-managed-authorization-only"]
- time: "2026-08-15T00:13:24.154Z"
  kind: "evidence"
  summary: "Browser-based sign-in is a reusable Otto platform for connectors and adapters, not Zoom-specific behavior. It must have a shared daemon-owned attempt lifecycle and provider-specific drivers, so recovery, secure storage boundaries, signed-in identity, and browser-independent retry work consistently across integrations."
  source: "Explicit user direction, 2026-08-14"
  affects: ["connectors","provider-neutral-communications-hub"]
- time: "2026-08-15T00:24:22.170Z"
  kind: "evidence"
  summary: "Implemented a provider-neutral browser authorization driver registry and capability-gated `integrations.authorization.start_browser.request` / response. Zoom Team Chat is the first registered driver. `BrowserAuthorizationAttemptManager` replaces only Otto's prior callback listener/verifier, rejects stale callbacks without disturbing the current attempt, and clears timeouts safely. The existing connector OAuth broker now follows the same stale-callback rule. Focused protocol, shared-service, attempt-lifecycle, and Zoom OAuth tests passed (19 tests); targeted lint and server/app typechecks passed."
  source: "Implementation verification, 2026-08-14"
  affects: ["connectors","zoom-settings-and-titlebar-entrypoints"]
- time: "2026-08-15T00:38:21.192Z"
  kind: "evidence"
  summary: "A browser/Marketplace error can leave Zoom with no callback to Otto, so the daemon remains authorizing. The Settings UI must never infer that a browser remains open and must keep its recovery action enabled during authorizing. The action is labeled Start again and replaces only Otto's pending attempt; it does not require users to close a browser or tab."
  source: "User-observed Zoom OAuth recovery failure and implementation correction, 2026-08-14"
  affects: ["zoom-settings-and-titlebar-entrypoints"]
- time: "2026-08-15T00:40:54.125Z"
  kind: "evidence"
  summary: "Regression analysis found Otto had diverged from the proven Zoom companion POC in two authorization-contract inputs: it changed the exact loopback redirect from `http://localhost:53682/callback` to a new 127.0.0.1:6872 path, and it requested Team Chat scopes not present in the approved Zoom scope set. Otto now restores the proven redirect/listener contract and requests only the configured scopes; it also removes the undocumented `include_granted_scopes` parameter. Focused OAuth and Settings tests, lint, and server/app typechecks passed."
  source: "POC comparison and implementation correction, 2026-08-14"
  affects: ["zoom-uses-otto-managed-authorization-only"]
- time: "2026-08-15T00:52:20.168Z"
  kind: "evidence"
  summary: "Correction to prior redirect inference: Zoom returned `Invalid redirect: http://localhost:53682/callback (4,700)`, proving the currently registered app expects Otto's `http://127.0.0.1:6872/integrations/zoom-team-chat/oauth/callback` redirect, not the older POC URL. Otto was reverted to that registered redirect. The unrelated scope cleanup remains: unapproved session/shared-space scopes and the undocumented authorization parameter stay removed."
  source: "Zoom invalid_redirect evidence, 2026-08-14"
  affects: ["zoom-uses-otto-managed-authorization-only"]
- time: "2026-08-15T00:59:54.448Z"
  kind: "evidence"
  summary: "Correction to the earlier scope-removal hypothesis: the product owner confirmed that `team_chat:read:list_user_sessions`, `team_chat:read:list_shared_spaces`, and `team_chat:read:list_shared_space_channels` are present in the Otto Zoom Marketplace app. Otto's current Home sync calls the first two endpoints, so their absence from Otto's OAuth request was a real code-to-grant mismatch. The authorization code now records the full approved Marketplace inventory separately from the actively requested OAuth scopes, maps every currently called operation to its required scope, and tests that each active scope is both approved and requested. Vendor portal configuration cannot be safely introspected by Otto at runtime; a scope change remains an explicit portal + code + reauthorization release step."
  source: "User-provided Zoom Marketplace scope inventory, 2026-08-14; verified against current Zoom Team Chat adapter calls."
