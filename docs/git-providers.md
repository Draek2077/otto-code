# Git hosting providers

Otto's pull-request and issue features - the PR panel, checks, issue/PR search and attachments, PR checkout, merge/auto-merge - sit behind a **provider-neutral git-hosting layer**. GitHub and **Bitbucket Cloud** are both first-class as of 0.5.0. This is the same leveling-up pattern as the rest of the fork: a capability isn't done when one provider has it; it's done when they all do.

The build history and locked product decisions live in `archive/projects/git-hosting-providers/` (archived); this doc is the durable architecture. User-facing setup is [public-docs/git-providers.md](../public-docs/git-providers.md).

## The two contracts

- **Connections belong to the host, with project selection overrides.** The **Git connections** section in host **Workspaces** settings manages reusable named accounts and a default per provider and server. **Project Settings → Git connections** can inherit that default or choose another connection. Worktrees inherit their owning project's selection, including worktrees outside the project folder.
- **A workspace's provider is auto-detected from its Git remote.** SSH aliases are resolved to their canonical hostname. This identifies the API server, not the API account. Commit author settings, SSH keys and Git credential helpers remain owned by Git.

## Resolution: cwd → provider → service

`packages/server/src/services/git-hosting/resolver.ts` is the entry point. `resolveForCwd(cwd)` picks the provider with this precedence:

1. `otto.json` `gitHosting.provider` override (an **optional escape hatch**, e.g. for future GitHub Enterprise custom domains - **not surfaced in the UI**),
2. the provider derived from the git remote (`deriveProviderFromRemote` in `resolver.ts`, over the URL parsers in `packages/protocol/src/git-remote.ts`),
3. default `"github"`.

Resolutions are cached 30s per cwd; daemon configuration and connection changes invalidate them. `resolveForProvider(id)` uses the host default for host-level operations. Connection-bound adapters have separate caches, polling and rate-limit state per connection revision. The existing ambient CLI/configuration path remains available when no connection is selected.

### Account selection

`git-hosting/connection-store.ts` owns connection metadata and selection. For a provider and canonical API server, resolution chooses the project's explicit binding first, then the host default. A missing or deleted selected connection is an error; it never falls through to another identity. Selecting **Use host default** deliberately removes a project override. Selecting **Use existing host configuration** deliberately removes a host default.

`connection-router.ts` composes this selection around Paseo's `ForgeService` through bootstrap's `forgeOverrides` seam. `connection-drivers.ts` supplies command-local credentials to GitHub and GitLab, an explicit named login to tea, and a credential-bound native REST adapter to Bitbucket Cloud. No `gh auth switch`, process-wide environment mutation, or automatic sign-in occurs. Canonical remote hosts are checked before using a saved credential. Connection changes restart observed PR lookups and suppress results from superseded polls and in-flight snapshots.

Saved custom servers also feed the Forge resolver's configured-host lookup, so an earlier failed automatic probe cannot hide a newly configured server. Existing Forge adapter manifests and provider capabilities remain authoritative.

## Service interface & capabilities

`GitHostingService` (`packages/server/src/services/git-hosting/types.ts`) is the structural extraction of the old `GitHubService`: `listPullRequests`, `listIssues`, `getPullRequest`, `getPullRequestCheckoutTarget`, `getCurrentPullRequestStatus` (+ retain-based polling), `getPullRequestTimeline`, `searchIssuesAndPrs`, `createPullRequest`, `mergePullRequest`, `enable/disablePullRequestAutoMerge`, `getGitHubCheckDetails`, `isAuthenticated`.

`router.ts` is a `GitHubService`-shaped facade: each method resolves the cwd's provider, then delegates. Existing call sites (session, checkout, auto-archive, otto-tools) go through the router unchanged. Workspace PR status uses the Forge registry directly: `github.com` resolves to `github`, while `bitbucket.org` resolves to the first-class `bitbucket-cloud` Forge. Bootstrap binds that Forge to a provider-pinned adapter, which obtains only Bitbucket's configured REST service and never re-routes through GitHub.

**Three methods deliberately bypass the router: `listRepositories`, `listOwners`, `createRepository`.** Every other method takes a cwd, because it describes a checkout that already exists. These describe an _account_, and the New project page calls them before any repository is on disk - there is no cwd to resolve a provider from. They go through `resolveForProvider(id)` instead, and they are optional on the interface: a provider without the capability leaves the method undefined rather than throwing at call time. See [docs/new-project.md](new-project.md).

**No fake parity.** Each provider advertises a `GitHostingCapabilities` descriptor and the client renders only capability-true actions:

| Capability         | GitHub | Bitbucket Cloud v1 |
| ------------------ | :----: | :----------------: |
| `draftPrs`         |   ✓    |         ✓          |
| `reviewDecisions`  |   ✓    |         ✓          |
| `reviewThreads`    |   ✓    |         ✓          |
| `commentReactions` |   ✓    |         ✗          |
| `autoMerge`        |   ✓    |         ✗          |
| `mergeQueue`       |   ✓    |         ✗          |
| `checkAnnotations` |   ✓    |         ✗          |
| `checkDetails`     |   ✓    |         ✗          |
| `issues`           |   ✓    | ✗ (teams use Jira) |
| `listRepositories` |   ✓    |         ✓          |
| `createRepository` |   ✓    |         ✓          |

The GitHub adapter (`github/`) uses the existing gh-CLI service. Bitbucket Cloud (`bitbucket-cloud-service.ts`) is a native REST 2.0 client (`https://api.bitbucket.org/2.0`) that mirrors the GitHub service's discipline - 30s TTL cache, single-flight, retain-based polling - with more conservative poll intervals (30s pending / 180s settled) to respect Bitbucket's ~1000 req/hour budget. Its `listIssues` returns `[]`; check-details and auto-merge throw an unsupported-capability error.

## Review discussions

The PR activity timeline carries opaque provider comment and thread identifiers through one neutral model. A thread groups its root comment and replies, exposes its resolved and outdated state when the forge provides it, and can be resolved or reopened through the provider-neutral `hosting.pull_request_thread.set_resolved.*` RPC. GitHub uses review-thread GraphQL mutations; Bitbucket Cloud resolves the root comment through its native `/resolve` endpoint. A successful mutation invalidates the timeline so the server remains the source of truth.

Comment reactions are similarly modelled as aggregate counts plus the current viewer's state and mutate through `hosting.pull_request_comment.set_reaction.*`. GitHub supports those operations. Bitbucket Cloud does not document a comment-reaction API, so its capability is false and the client does not offer a substitute.

## Configuration & secrets

- **Saved connections use the shared daemon credential vault.** `$OTTO_HOME/forge-connections.json` contains only ids, labels, verified accounts, methods, revisions, host defaults and project references. Neither secrets nor machine-specific connection ids are committed to `otto.json` or project knowledge. Replacing credentials uses versioned vault keys and an atomic metadata write; failed persistence leaves the previous connection usable. Retired vault entries are deleted after metadata commits.
- **GitHub** supports importing a specific existing `gh` account or entering an API token. Import reads `gh auth token --hostname HOST --user LOGIN`, ignoring ambient token variables, verifies the account, and saves a snapshot in the vault. It never changes the CLI's active account. A later CLI token rotation requires reconnecting the Otto connection.
- **GitLab** accepts an API token and still uses `glab` for Forge operations. **Bitbucket Cloud** accepts an Atlassian email and API token and uses native REST. **Gitea, Forgejo and Codeberg** select an existing named `tea` login; tea retains its token and Otto verifies the selected endpoint and account before commands.
- Token entry is write-only through the authenticated settings request. It is cleared on submit, excluded from the query mutation cache, redacted from structured logging, and absent from every settings response. The host checks account identity before saving; repository-specific permissions are checked by the actual operation. A successful account check does not prove access to every repository.
- Existing host Atlassian configuration remains available for Jira and for Bitbucket when no saved connection is selected. It is not automatically migrated, copied or deleted by these settings.
- Browser OAuth sign-in is not provided by this connection-selection feature. No Otto GitHub OAuth client is configured here. Missing credentials remain an actionable error, without background browser or terminal prompts.

## Protocol (additive only)

- Capability flag `server_info.features.gitHostingProviders` - `COMPAT(gitHostingProviders)` at the client gate.
- Saved connection settings use the additive `forgeConnections` capability and `forge.connections.manage.request/response`. The action union supports list, save/reconnect, select and remove. Save-and-select is atomic. New clients show an update message on older hosts.
- Provider id: `GitHostingProviderIdSchema = enum(["github","bitbucket-cloud"])`, but the **wire id is an open string** (`GitHostingProviderIdWireSchema` + `normalizeGitHostingProviderId`, `packages/protocol/src/git-hosting.ts`) so a newer provider doesn't break old peers.
- New dotted RPCs (per [docs/rpc-namespacing.md](rpc-namespacing.md)): `hosting.search.request/response` (provider-neutral issue/PR search; the response carries the resolved `provider`) and `hosting.auth_status.request/response` (host-level connection check driving the settings rows). The flat `github_search_request` is legacy and won't grow.
- Attachments gain provider-neutral kinds `hosting_pr` / `hosting_issue` (each with a `provider` field). Legacy `github_pr` / `github_issue` remain accepted forever, and a new client still sends them for a GitHub-provider project talking to an old daemon (feature contract: one gate, no fallback logic). See [glossary Attachment](glossary.md).
- Auto-merge and check-details stay on the GitHub-only `checkout.github.*` RPCs - auto-merge is genuinely a GitHub capability in v1.

## Security guardrails

- **Auth built per request, never stored.** The Bitbucket Basic auth header is constructed in a closure per request (`hosting-http-client.ts`) and never logged; `GitHostingRequestError` strips auth headers and bodies; no token in URLs; HTTPS enforced.
- **Mutation preconditions re-checked daemon-side.** Before a merge, the daemon re-fetches the PR and rejects unless it's open/mergeable - GitHub via `assertDirectPullRequestMergeReady` (`github-service.ts`), Bitbucket via a fresh `fetchPullRequest` state check. All mutations are single user-initiated RPCs, never issued from polling or reconciliation.
- **Bounded retries / rate-limit respect.** At most one retry, only on GET 429/5xx, honoring `Retry-After` with a hard cap; 4xx never retries; a 429 puts the instance into a cooldown and serves reads from cache.

## Deferred (out of v1)

Bitbucket Server / Data Center (different API and repo-path shape), Bitbucket pipelines log fetch, Bitbucket issue search, and Forge browser OAuth authorization. GitLab, Gitea, Forgejo and Codeberg use the wider [Forge architecture](forge-providers.md); host repository creation remains limited to adapters that expose that capability.
