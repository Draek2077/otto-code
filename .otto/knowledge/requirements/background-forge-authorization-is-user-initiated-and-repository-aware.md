---
id: "background-forge-authorization-is-user-initiated-and-repository-aware"
kind: "requirement"
title: "Background forge authorization is user initiated and repository aware"
status: "proposed"
tags: ["git","github","authentication","integrations","ux"]
created_at: "2026-09-09T12:36:18.803Z"
updated_at: "2026-09-09T17:51:40.546Z"
---
# Background forge authorization is user initiated and repository aware

<!-- compiled_truth -->

Background Forge operations never launch a browser, prompt in a terminal, or switch a globally active CLI account. Git commit identity and SSH transport configuration remain owned by Git; an SSH alias identifies the API server but does not provide its API credential.

Connections are reusable host-owned records scoped to a provider, API server and verified account. A host can choose one default for each provider/server. Project Settings can inherit the host default or explicitly select another connection; worktrees inherit their owning project, including external worktree paths. Project references are daemon-owned metadata, not repository configuration or secrets. A missing or deleted selected connection must fail with a setup error rather than silently falling through to another account. Explicitly removing an override restores inheritance.

Otto composes connection selection around Paseo's ForgeService through its existing bootstrap forgeOverrides and Git hosting router seams. Credentials are applied per command or REST adapter, with separate service caches and polling per connection revision. Changing a selection refreshes observed PR state and suppresses superseded polling and in-flight snapshot results. Saved custom server identities bypass stale negative provider probes.

Implementation status: host and project Git connections settings, vault-backed connection records, atomic save/select, host defaults, project overrides, reconnect/remove, SSH hostname normalization, and per-connection GitHub/GitLab/Bitbucket/tea routing are implemented locally. GitHub imports a specified existing gh account or accepts an API token; GitLab and Bitbucket accept tokens; Gitea/Forgejo/Codeberg select an existing tea login. Token entry is explicit and write-only, with secrets absent from settings responses, metadata and mutation caches. Existing host CLI/Atlassian configuration remains available when no saved binding exists. Focused tests establish routing, persistence failure behavior, credential revision isolation, worktree ownership, and stale poll/snapshot suppression. Live multi-account provider operations and packaged UI behavior have not been verified.

Guided browser authorization remains a separate unfinished part of this requirement. No registered Otto GitHub OAuth client is configured by this change. The connection model is intended to reuse the shared Integration Authorization platform for future OAuth credential acquisition; the current settings do not claim to offer browser OAuth sign-in.

## Timeline

- time: "2026-09-09T12:36:18.803Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-09-09T12:36:18.803Z"
  kind: "evidence"
  summary: "User discussion in this chat, 2026-09-09: multiple repositories already use correct Git/SSH aliases; users should not have to learn CLI credential setup; accepted daemon connection state, explicit UI Connect, and automatic retry flow. Inspected packages/server/src/services/github-service.ts, packages/server/src/server/integration-authorization/browser-authorization-service.ts, packages/app/src/git/diff-pane.tsx, and docs/connectors.md. GitHub documents the device authorization flow and its required registered client_id at https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow. No live OAuth authorization was attempted."
- time: "2026-09-09T17:51:40.546Z"
  kind: "decision"
  summary: "The user revised the account-selection design to reusable host connections with host defaults and explicit project overrides, then explicitly requested implementation. This replaces the earlier no-persistent-mapping assumption. Source implementation and focused routing/poll tests now establish the connection-selection behavior; browser OAuth onboarding remains unfinished."
  source: "User direction and local implementation verification, 2026-09-09."
