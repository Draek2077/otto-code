# Bitbucket Cloud

Bitbucket Cloud uses Paseo's forge registry, checkout state, PR pane, attachments,
merge actions and clone destination flow. The adapter lives under server and app
`otto/bitbucket/`; shared registrations carry `OTTO(bitbucket)` markers. Cloud
support applies to `bitbucket.org`, its SSH aliases and `altssh.bitbucket.org:443`.
Bitbucket Data Center has a different API and is not registered as Cloud.

## Account ownership

Host Settings > Plugins > Configure Bitbucket opens named connections. Project
Settings selects a project override; an unset override inherits the host default.
Without a named selection, the host's shared Atlassian account supplies the API
identity. An unavailable or removed selected connection refuses access instead
of switching accounts. Git continues to own SSH keys and credential helpers.

The daemon uses Atlassian email and an API token against the fixed official
Bitbucket Cloud REST origin. Tokens stay in the shared OS credential vault;
account metadata and originating revisions use the shared integration registry.
Settings reads do not probe the API or access native credentials. Replacement and
removal are explicit. A blank token cannot erase a saved key. Unknown writes
retain their credential for reconciliation and require explicit reload.

The read-only Otto 0.9 bridge recognizes `forge-connections.json` and its versioned
`forge` vault identities. The first explicit metadata save preserves unknown
fields in the new registry without modifying the old file. External editors do
not participate in the daemon's metadata queue; it is not a cross-process transaction.

## API and Git operations

The native adapter reads PR summaries, approvals, requested changes, comments,
resolved discussions and build statuses. Source-repository identity is retained
for fork checkout. Open PRs remain attached while a checkout has unpushed commits;
terminal PRs require the recorded head SHA to match. Shared source links and pasted
PR attachments use Bitbucket's actual URL grammar.

Create, merge/squash and discussion Resolve/Reopen use explicit actions. They do
not automatically retry a write or delete a source branch. Unknown outcomes
require remote-state inspection and refresh. Auto-merge, merge queues, native
issues and detailed check logs are not advertised by this adapter.

Repository settings expose explicit workspace discovery, repository search,
private/public repository creation and SSH/HTTPS clone handoff. Discovery uses
the [current user-workspaces endpoint](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-workspaces/),
not the retired cross-workspace permissions route. A workspace ID can also be
entered directly. Discovery needs `read:workspace:bitbucket`; repository and PR
operations need their corresponding [API-token permissions](https://support.atlassian.com/bitbucket-cloud/docs/api-token-permissions/).
The existing Git clone destination page accepts complete Bitbucket remotes.

Requests reject redirects and credential-bearing or foreign pagination links.
Responses, pagination, caches and demand-owned polls are bounded. Changing the
selected account invalidates cached reads and pending poll authority. No poll
survives its final consumer or daemon shutdown.

## Verification boundary

Focused fixtures cover account preservation, vault identity, conflicts, request
binding, writes without retries, polling ownership and local form lifecycle.
The app acceptance journey exercises the registered settings page on wide and
compact layouts, validation, retained drafts and explicit reload after a real
metadata conflict. Its stale save is refused before credential storage. It does
not establish a live employer account's permissions, native credential writes,
or Git authentication. These require acceptance against that account and host.
