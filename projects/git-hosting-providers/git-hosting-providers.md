# Git Hosting Providers

Charter: abstract Otto's GitHub-only hosting features (PR panel, checks, issue/PR search and
attachments, PR checkout, merge/auto-merge) behind a provider-neutral **git hosting** layer, and
ship **Bitbucket Cloud** as the second provider. Same leveling-up pattern as the rest of the fork:
a capability isn't done when one provider has it; it's done when they all do.

## Product decisions (locked)

- **Providers are configured once per host.** A new host settings section, **Git providers**
  (`git-providers` slug, next to Providers/Usage), holds credentials for each provider — GitHub
  (via the `gh` CLI it already uses) and Bitbucket Cloud (Atlassian email + API token). "All git
  providers set up and working at once" is literal: configure both, both are live.
- **A workspace's provider is auto-detected from its git remote.** `bitbucket.org/...` →
  Bitbucket, `github.com/...` → GitHub (standard scp-style SSH remotes parse too). Switching to a
  project on a Bitbucket remote switches all PR/issue functionality automatically, with nothing to
  configure per-project. `otto.json` `gitHosting.provider` remains an **optional override** for
  future edge cases (e.g. GitHub Enterprise custom domains) but is not surfaced in the UI.
- **Credentials never touch `otto.json`.** They live only in the daemon's private
  `$OTTO_HOME/config.json` (`gitHosting.providers.<provider>`, restrictive perms), one set per
  provider per host — enter your Bitbucket token once, not per repo.
- **No fake parity.** Providers expose a capabilities descriptor; the UI gates features on it
  (Bitbucket Cloud v1: no auto-merge, no merge queue, no check-run annotations). No degraded
  emulation paths.

_(Design note: an earlier iteration made provider selection + credentials per-project. That
re-entered the same token for every repo on a provider; host-level credentials + remote
auto-detection resolve that and match how IDEs authenticate to GitHub/Bitbucket once.)_

## Current state (mapped 2026-07-10)

- `packages/server/src/services/github-service.ts` — `GitHubService` interface (~15 methods) over
  the `gh` CLI (REST via `gh api`, GraphQL via `gh api graphql`, auth via `gh auth`). Single
  instance created in `bootstrap.ts` and injected everywhere. TTL cache (30s) + single-flight +
  retain-based PR status polling (20s pending / 120s settled, error backoff capped at 300s).
- Plain git operations (worktrees, checkout, diff, push/pull) are already provider-agnostic.
- Remote detection: `packages/protocol/src/git-remote.ts` hard-codes `github.com`;
  `packages/server/src/utils/github-remote.ts` adds SSH-alias resolution.
- Wire protocol is GitHub-branded: `github_search_request`, `checkout.github.set_auto_merge.request`,
  `checkout.github.get_check_details.request`, attachment kinds `github_pr`/`github_issue`,
  `githubPrNumber`, `githubFeaturesEnabled`, `github` facts blob on checkout PR status.
- App: PR panel (`packages/app/src/git/pull-request-panel/`), actions store merge-readiness reads
  GitHub GraphQL facts, `use-github-search-query`, composer auto-attach from `github.com` URLs,
  new-workspace checkout-PR flow, `github-refs.ts`/`github-url.ts`, GitHub icon, i18n strings.
- Projects: `FileBackedProjectRegistry` (`$OTTO_HOME/projects/projects.json`), cwd→project via
  `classifyDirectoryForProjectMembership` / remote-derived grouping keys. Project settings UI edits
  per-repo `otto.json` via `read_project_config_request`/`write_project_config_request`.
- Daemon secrets precedent: `persisted-config.ts` (`$OTTO_HOME/config.json`, private file perms,
  plaintext JSON) + `DaemonConfigStore` hot-reload (`MutableDaemonConfig` patch → persist → notify).

## Architecture

### 1. Provider-neutral service (server)

New `packages/server/src/services/git-hosting/`:

- `types.ts` — `GitHostingProviderId = "github" | "bitbucket-cloud"`, `GitHostingService`
  (structural extraction of today's `GitHubService`: list/search PRs+issues, get PR, checkout
  target, current PR status + retained polling, timeline, check details, create/merge/auto-merge,
  isAuthenticated, invalidate, dispose), and `GitHostingCapabilities`:
  `{ autoMerge, mergeQueue, checkAnnotations, checkDetails, draftPrs, reviewDecisions, issues }`.
- Provider-specific merge facts stay provider-tagged: the status payload carries a generic core
  (state, refs, checks summary, review decision, mergeable) plus the existing `github` facts blob
  for GitHub and a `bitbucket` facts blob for Bitbucket (merge strategies allowed, participants).
- `github/` — adapter over the existing gh-CLI service (no behavior change; existing file keeps
  its tests).
- `bitbucket-cloud/` — REST 2.0 client (`https://api.bitbucket.org/2.0/...`), Basic auth with
  Atlassian account email + API token. Mirrors the GitHub service's discipline: 30s TTL cache,
  single-flight de-dupe, retain-based polling. Poll intervals are more conservative than
  GitHub's (30s pending / 180s settled, backoff cap 300s) to respect Bitbucket Cloud's
  ~1000 requests/hour API budget.
- `resolver.ts` — cwd → provider via `deriveProviderFromRemote(remoteUrl)` (`otto.json`
  `gitHosting.provider` override wins if set) → host-level per-provider credentials → cached
  service. One Bitbucket instance per host, keyed by credential fingerprint, rebuilt when the token
  rotates; `resolveForProvider(id)` answers host-level auth-status checks. Resolutions cached 30s
  per cwd; `invalidateAll()` on any daemon-config change. No project/workspace registry needed.

### 2. Configuration & secrets

- `$OTTO_HOME/config.json` (private): `gitHosting.providers.bitbucketCloud: { email, apiToken }` —
  one set per provider per host. Written only via daemon-config patch RPC; follows the existing
  provider-key pattern (echoed in get_daemon_config like other provider keys — the WS channel is
  the trust boundary per SECURITY.md). Never logged; redacted from error messages and traces.
- GitHub needs no stored credential (the `gh` CLI owns auth), so its card is a connection check
  only; Bitbucket Cloud's card holds the email + API token fields.
- `otto.json` (committed) may carry `{ "gitHosting": { "provider": "..." } }` as an optional
  override; absent (the norm) → provider comes from the remote. Never holds credentials.

### 3. Protocol (backward compatible, additive only)

- `server_info.features.gitHostingProviders` — single capability flag.
  `// COMPAT(gitHostingProviders)` at the client gate.
- New dotted RPCs (per docs/rpc-namespacing.md; flat `github_search_request` is legacy and will
  not grow):
  - `hosting.search.request/response` — provider-neutral issue/PR search
    (`kinds: ["issue","pr"]`), response carries the resolved `provider`.
  - `hosting.auth_status.request/response` — host-level provider connection check
    (`{ provider }` → `{ provider, authenticated, error }`), drives the settings status rows.
- Checkout PR status payload gains optional `hosting: { provider, capabilities, bitbucket? }`
  alongside the existing `github` field (both present for GitHub repos; old clients keep parsing
  the shape they know).
- Attachments: new kinds `hosting_pr` / `hosting_issue` with a `provider` field, used by new
  clients when the flag is present; `github_pr`/`github_issue` remain accepted and are still what
  a new client sends for GitHub-provider projects talking to old daemons (feature contract: no
  fallback logic beyond the single gate).
- Legacy `github_*` RPCs keep working verbatim against GitHub-provider projects. For a
  Bitbucket-provider project, an old client simply has no hosting features (feature contract:
  upgrade the host/client; no emulation).
- Existing `checkout.github.set_auto_merge` / `checkout.github.get_check_details` remain
  GitHub-only (auto-merge is genuinely a GitHub capability in v1; check details gets a
  provider-neutral successor only when Bitbucket pipelines log fetch ships — deferred).

### 4. App

- New host settings section **Git providers** (`git-providers` slug + `HostGitProvidersPage`,
  `GitPullRequest` icon): a GitHub card (connection check against `gh auth status`) and a
  Bitbucket Cloud card (email + API token written via daemon-config patch, never otto.json, plus a
  connection check). Gated on the feature flag with the standard "Update the host" affordance.
- PR panel / actions / search / auto-attach consume `provider` + `capabilities` from the status
  payload; auto-merge and check-details actions render only when the capability is true. Bitbucket
  merge-readiness reads `hosting.bitbucket` (allowed merge strategies) since it has no GitHub facts.
- URL ref auto-attach learns `bitbucket.org/<workspace>/<repo>/pull-requests/<n>`.
- Provider icon (existing GitHub icon + new Bitbucket icon via `GitHostingIcon`); i18n strings
  de-branded across all locales, English-first per build-first-translate-last.

## Security & abuse guardrails

- **Polling discipline**: retain-count polling only (no poll without a live subscriber);
  consecutive-error backoff capped at 300s; one in-flight request per cache key (single-flight).
  GitHub keeps 20s/120s; Bitbucket Cloud polls 30s/180s to respect its ~1000 req/hour budget.
- **No unbounded retries**: HTTP calls make at most one retry, only on 429/5xx, honoring
  `Retry-After` with a hard cap; 4xx (auth, not-found) never retries.
- **Rate-limit respect**: on 429 the provider instance enters a cooldown window; reads served from
  cache; poll targets back off as if erroring.
- **Mutation preconditions enforced daemon-side** (mirror of `assertDirectPullRequestMergeReady`):
  merge only when the provider reports the PR open and mergeable; no create-in-a-loop paths — all
  mutations are single user-initiated RPCs, never issued from polling or reconciliation code.
- **Credential hygiene**: tokens only in `$OTTO_HOME/config.json` (private perms), HTTPS only,
  Basic auth header built per request and never logged; error objects strip auth headers; no token
  in URLs.

## Work plan

1. Charter (this doc).
2. Protocol additions (types, schemas, RPCs, flag).
3. Server: neutral interface + GitHub adapter (pure refactor, tests stay green).
4. Server: per-project config resolution + credential store + settings RPC surface.
5. Server: Bitbucket Cloud service + unit tests (fetch stubbed, deterministic).
6. Server: wire resolver through session/checkout/workspace-git-service/auto-archive/otto-tools.
7. Client: RPC methods + feature detection.
8. App: project settings section; PR UI generalization; icons; i18n.
9. Typecheck, lint, targeted tests, format.

## Deferred (explicitly out of v1)

- Bitbucket Server / Data Center (different API + repo path shape `/projects/KEY/repos/name`).
- GitLab, Gitea; GitHub Enterprise custom hosts (needs configurable host→provider map).
- Bitbucket pipelines log fetch (check-details successor RPC).
- Bitbucket issue tracker search (most Bitbucket Cloud teams use Jira; `issues` capability is
  false in v1).
- OAuth flows; v1 is API-token only.
