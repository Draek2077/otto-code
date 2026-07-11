# Git hosting providers

Otto's pull-request and issue features — the PR panel, checks, issue/PR search and attachments, PR checkout, merge/auto-merge — sit behind a **provider-neutral git-hosting layer**. GitHub and **Bitbucket Cloud** are both first-class as of 0.5.0. This is the same leveling-up pattern as the rest of the fork: a capability isn't done when one provider has it; it's done when they all do.

The build history and locked product decisions live in [projects/git-hosting-providers/git-hosting-providers.md](../projects/git-hosting-providers/git-hosting-providers.md); this doc is the durable architecture. User-facing setup is [public-docs/git-providers.md](../public-docs/git-providers.md).

## The two contracts

- **Providers are configured once per host**, in a **Git providers** settings section. Both can be live at once — configure GitHub and Bitbucket Cloud and each workspace uses whichever matches its remote. In the shipped app the cards are folded into the **Workspaces** settings page (`packages/app/src/screens/settings/host-page.tsx` → `GitProvidersSettingsCards`), not a standalone sidebar entry — too few options to warrant their own category. (The charter's `git-providers` slug / `HostGitProvidersPage` was the original plan; the shipped code folded it in.)
- **A workspace's provider is auto-detected from its git remote.** `github.com/…` → GitHub, `bitbucket.org/…` → Bitbucket Cloud (scp-style SSH remotes parse too). Nothing to configure per project. Switching to a Bitbucket-remote project switches all PR/issue functionality automatically.

## Resolution: cwd → provider → service

`packages/server/src/services/git-hosting/resolver.ts` is the entry point. `resolveForCwd(cwd)` picks the provider with this precedence:

1. `otto.json` `gitHosting.provider` override (an **optional escape hatch**, e.g. for future GitHub Enterprise custom domains — **not surfaced in the UI**),
2. the provider derived from the git remote (`deriveProviderFromRemote` in `resolver.ts`, over the URL parsers in `packages/protocol/src/git-remote.ts`),
3. default `"github"`.

Resolutions are cached 30s per cwd; `invalidateAll()` fires on any daemon-config change. `resolveForProvider(id)` answers host-level auth-status checks (the settings "Check connection" rows). One Bitbucket service instance per host, keyed by a **SHA-256 fingerprint** of the credentials (never the raw token), rebuilt when the token rotates.

## Service interface & capabilities

`GitHostingService` (`packages/server/src/services/git-hosting/types.ts`) is the structural extraction of the old `GitHubService`: `listPullRequests`, `listIssues`, `getPullRequest`, `getPullRequestCheckoutTarget`, `getCurrentPullRequestStatus` (+ retain-based polling), `getPullRequestTimeline`, `searchIssuesAndPrs`, `createPullRequest`, `mergePullRequest`, `enable/disablePullRequestAutoMerge`, `getGitHubCheckDetails`, `isAuthenticated`.

`router.ts` is a `GitHubService`-shaped facade: each method resolves the cwd's provider, then delegates. Existing call sites (session, checkout, workspace-git-service, auto-archive, otto-tools) go through the router unchanged.

**No fake parity.** Each provider advertises a `GitHostingCapabilities` descriptor and the client renders only capability-true actions:

| Capability         | GitHub | Bitbucket Cloud v1 |
| ------------------ | :----: | :----------------: |
| `draftPrs`         |   ✓    |         ✓          |
| `reviewDecisions`  |   ✓    |         ✓          |
| `autoMerge`        |   ✓    |         ✗          |
| `mergeQueue`       |   ✓    |         ✗          |
| `checkAnnotations` |   ✓    |         ✗          |
| `checkDetails`     |   ✓    |         ✗          |
| `issues`           |   ✓    | ✗ (teams use Jira) |

The GitHub adapter (`github/`) wraps the existing gh-CLI service with no behavior change. Bitbucket Cloud (`bitbucket-cloud-service.ts`) is a native REST 2.0 client (`https://api.bitbucket.org/2.0`) that mirrors the GitHub service's discipline — 30s TTL cache, single-flight, retain-based polling — with more conservative poll intervals (30s pending / 180s settled) to respect Bitbucket's ~1000 req/hour budget. Its `listIssues` returns `[]`; check-details and auto-merge throw an unsupported-capability error.

## Configuration & secrets

- **Credentials never touch `otto.json`.** They live only in the daemon's private `$OTTO_HOME/config.json` under `gitHosting.providers.bitbucketCloud: { email, apiToken }` (`packages/server/src/server/persisted-config.ts`, restrictive file perms), one set per provider per host.
- **GitHub needs no stored credential** — the `gh` CLI owns auth, so its card is a connection check only.
- On the wire: `MutableGitHostingConfigSchema` on `MutableDaemonConfigSchema` (`packages/protocol/src/messages.ts`), written via the daemon-config patch RPC and echoed in `get_daemon_config` like other provider keys (the WS channel is the trust boundary per [SECURITY.md](../SECURITY.md)).

## Protocol (additive only)

- Capability flag `server_info.features.gitHostingProviders` — `COMPAT(gitHostingProviders)` at the client gate.
- Provider id: `GitHostingProviderIdSchema = enum(["github","bitbucket-cloud"])`, but the **wire id is an open string** (`GitHostingProviderIdWireSchema` + `normalizeGitHostingProviderId`, `packages/protocol/src/git-hosting.ts`) so a newer provider doesn't break old peers.
- New dotted RPCs (per [docs/rpc-namespacing.md](rpc-namespacing.md)): `hosting.search.request/response` (provider-neutral issue/PR search; the response carries the resolved `provider`) and `hosting.auth_status.request/response` (host-level connection check driving the settings rows). The flat `github_search_request` is legacy and won't grow.
- Attachments gain provider-neutral kinds `hosting_pr` / `hosting_issue` (each with a `provider` field). Legacy `github_pr` / `github_issue` remain accepted forever, and a new client still sends them for a GitHub-provider project talking to an old daemon (feature contract: one gate, no fallback logic). See [glossary Attachment](glossary.md).
- Auto-merge and check-details stay on the GitHub-only `checkout.github.*` RPCs — auto-merge is genuinely a GitHub capability in v1.

## Security guardrails

- **Auth built per request, never stored.** The Bitbucket Basic auth header is constructed in a closure per request (`hosting-http-client.ts`) and never logged; `GitHostingRequestError` strips auth headers and bodies; no token in URLs; HTTPS enforced.
- **Mutation preconditions re-checked daemon-side.** Before a merge, the daemon re-fetches the PR and rejects unless it's open/mergeable — GitHub via `assertDirectPullRequestMergeReady` (`github-service.ts`), Bitbucket via a fresh `fetchPullRequest` state check. All mutations are single user-initiated RPCs, never issued from polling or reconciliation.
- **Bounded retries / rate-limit respect.** At most one retry, only on GET 429/5xx, honoring `Retry-After` with a hard cap; 4xx never retries; a 429 puts the instance into a cooldown and serves reads from cache.

## Deferred (out of v1)

Bitbucket Server / Data Center (different API + repo-path shape), GitLab, Gitea, GitHub Enterprise custom hosts (needs a configurable host→provider map), Bitbucket pipelines log fetch (the check-details successor), Bitbucket issue search (Jira is the norm), and OAuth flows (v1 is API-token only).
