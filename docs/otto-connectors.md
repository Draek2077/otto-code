# Connectors

Connectors are host-owned accounts and MCP connections shared by agent providers.
Open **Settings > Host > Plugins > Configure Connectors**. The installed list leads
to inline management; **Add connector** opens the searchable catalog or a custom
HTTP, SSE or local-command form. The existing Settings page owns the title,
scrolling, gutters and compact layout. Advanced options use existing expanders.

The structural SDK contracts are in `@getpaseo/plugin/otto/connectors`. The trusted
`otto-integrations` plugin registers the app-owned screen through
`@getpaseo/plugin/client/otto-connectors`. The feature is gated once by
`server_info.features.ottoConnectors`. Old daemons show an update requirement.

## Catalog and configuration

The catalog retains all 30 frozen Otto 0.9 entries: Google Drive, Gmail, Google
Calendar, Notion, Jira & Confluence, Box, Dropbox, Slack, Linear, monday.com,
ClickUp, Trello, Asana, Canva, Webflow, Intercom, HubSpot, Stripe, Square,
Airtable, Ahrefs, GitHub, Sentry, Supabase, Cloudflare, Netlify, Vercel, DeepWiki,
Local files and Persistent memory. Figma was not in the shipped frozen roster.
Each row cites its vendor's setup documentation. A historical verification date
is a source-review date, not proof of today's account access or distribution.

New default endpoints follow current official documentation:

- [Atlassian](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/)
  uses `https://mcp.atlassian.com/v2/mcp`.
- [Square](https://developer.squareup.com/docs/mcp) uses
  `https://mcp.squareup.com/mcp`. Its client allowlist still applies.
- [Asana](https://developers.asana.com/docs/integrating-with-asanas-mcp-server)
  uses `https://mcp.asana.com/v2/mcp`. V1 SSE was retired. V2 requires an MCP app
  registration and does not support dynamic registration. Its form accepts the
  user's client ID and write-only client secret and shows the exact host callback
  to register. Otto does not claim an Asana publisher registration.

Existing endpoints and their grants are never silently repointed. Catalog setup
is constructed on the daemon from the catalog ID, allowed folders and write-only
input. Local files require explicit absolute folders on the owning host. Custom
servers accept an HTTP/SSE endpoint or command, JSON arguments/environment, and
advanced headers, scopes and OAuth registration. Remote endpoints require HTTPS;
HTTP is accepted on literal loopback for local services. Commands run on the host
in the calling chat's working directory. Adding a command is explicit authority
to start that server, including package acquisition performed by its command.

An explicit Add or connection replacement is disabled until actual initialization
and tool discovery succeed. Failed discovery leaves a manageable saved connection
with a safe error. OAuth connections are admitted after successful consent and
verification. Global enable and per-tool switches are durable and checked again
before dispatch. Renaming preserves transport, authorization and tool selection.
Replacing configuration is an explicit new generation, never a credential merge.

## Existing access and secure storage

Preservation is part of the contract: retain existing keys, account grants,
publisher registrations, public client IDs, approved callbacks, hosting identities,
configured origins and unknown settings. Restoration does not rotate publisher
credentials, revoke accounts, migrate installed files or deploy an auth service.
Ordinary authorized token refresh remains part of OAuth use, with its newly
accepted result saved before later use.

`$OTTO_HOME/otto-config.json` is a read-only 0.9 source. Metadata overlays and
removal tombstones live in `$OTTO_HOME/integrations/connectors.json`; the original
file is never rewritten. Valid old connector IDs, transport details, inline grant
state and unknown fields survive. Invalid or duplicate old rows are quarantined
individually and can be reconfigured or removed without blocking other rows.

The shared authorization owner stores new private bundles in the existing OS
keyring, with immutable new identities and nonsecret pointers under
`$OTTO_HOME/integrations/authorization.json`. It preserves the original keyring
service `Otto Integration Authorization`, encoded host/integration/connection
tuple, and single-entry/chunked formats. There is no plaintext fallback.
Google and hosted compatibility readers use only the exact original
`google-connectors` or `connector-hosted-oauth` tuple. Account labels are read
without modifying `integration-authorizations.json`. Missing display metadata
does not delete a grant. Explicit edits publish into new storage; reads do not
migrate data. Explicit removal tombstones the connection; it does not delete the
original settings file or sweep legacy credentials.

Settings reads return only safe endpoint/command summaries, authorization state,
account labels and tool counts. Only the selected detail receives tool names,
descriptions and read-only hints. Full schemas stay on the daemon. Saved header,
environment, publisher-secret, token, proof, verifier and authorization-code values
never return to Settings or a provider configuration. User-entered replacement
values are ephemeral, write-only form fields.

Config and authorization have separate revisions. Each connection's refresh has
its own originating authorization revision; unrelated token renewal cannot
invalidate a user's settings form. Settings mutations use compare-and-swap and
retain failed drafts. Only proven pre-write validation permits a corrected
explicit save at the same revision. Conflict and unknown outcomes require an
explicit reload, with discard confirmation. Hidden write outcomes also require
reload; late acknowledgments never erase the retained draft or adopt a revision.

## Authorization ownership

The daemon owns discovery, registration, PKCE, exchange, renewal and callback
listeners. The renderer receives a consent URL and safe status. There is no RPC
for pasting or forwarding authorization codes. Generic dynamic registration and
registered public clients reuse the official MCP SDK. Code exchange and rotating
refresh are single attempts; an unknown refresh result persists a renewal guard
so the previous refresh token is not replayed automatically. A superseded
generation cannot restore a grant after replacement, disconnect or shutdown.

Slack keeps public client `12044001590499.12034876251863` and callback
`http://127.0.0.1:6871/connectors/oauth/callback`. Dropbox keeps public client
`ir4e1ixjf542mq8`, callback port 6872 at the same path, approved scopes and offline
access. Internal Slack approval and Dropbox owner/development access are historical
proof only. Broader vendor distribution approval is not implied.

Google Drive, Gmail and Calendar use native Google APIs, not a pretend MCP server.
The existing Desktop OAuth publisher registration is copied into the daemon
artifact in CI using the existing `OTTO_GOOGLE_OAUTH_CLIENT_JSON` or
`OTTO_GOOGLE_OAUTH_CLIENT_FILE` input. Runtime file overrides retain the same name.
No registration is fetched onto a developer machine. Required release builds fail
if registration is absent. Google keeps its loopback
`/integrations/google/callback` path with an ephemeral port, verified account email,
service scopes, offline access and write-only grants. The native tools cover Gmail
list/read/draft/send/reply/forward, Drive list/read/create/update and Calendar
list-calendars/list-events/read/create. Their fixed vendor API origins, result
bounds and scope maps live under `services/otto/connectors/google`.

Loopback consent must complete in a browser on the computer running the daemon.
A phone's localhost is not the remote host. Consent links and the host-browser
requirement are visible in Settings; codes are never relayed through the app.
Existing remote-host account access remains usable from mobile after host sign-in.
Fresh cross-device consent for Box and HubSpot uses the existing hosted service.

Box and HubSpot retain `https://auth.otto-code.me`, the
`OTTO_CONNECTOR_AUTH_URL` override, an explicitly empty override's disabled meaning,
and the hosted `/v1/grants` protocol. The daemon keeps the possession proof and
vendor tokens. The service keeps publisher client secrets. The service callback
remains `https://auth.otto-code.me/v1/callback`.

`packages/auth-service` preserves the existing `otto-auth` Worker, Cloudflare
account, domains, Durable Object class/migration, rate-limit namespaces and
`BOX_CLIENT_ID`/`BOX_CLIENT_SECRET`/`HUBSPOT_CLIENT_ID`/`HUBSPOT_CLIENT_SECRET`
binding names. None of those live resources is changed by restoring source.
The Connector Authentication workflow typechecks, tests and dry-builds the service;
synthetic Miniflare checks deny external networking. Production deployment is a
separate explicit manual operation, still gated by `AUTH_SERVICE_DEPLOY_ENABLED`
and the existing `CLOUDFLARE_API_TOKEN`. Ordinary CI does not deploy, provision
bindings, reset Durable Object data or call vendor accounts.

## Shared provider tool catalog

The same prepared `PaseoToolDefinition` list feeds native provider tool loops and
the normal authenticated agent MCP route. Only bound interactive chats receive
external account tools; unbound control-plane, voice-only and generation contexts
do not. The upstream MCP master switch, injection switch, provider tool policy
and provider permissions remain authoritative. Connector switches are independent
of Otto's internal tool groups. Vendor credentials never enter launch configs.
Read-only hints survive the shared bridge, including native-provider plan mode.

The client pool reuses `@getpaseo/plugin/server/otto-openai`'s canonical MCP
transport. HTTP connections share a host client; commands are working-directory
scoped. Connections initialize single-flight and serialize operations. MCP
catalog discovery is bounded to 1,024 tools and 4 MiB across all pages. Idle
clients close after five minutes. Later catalog construction refreshes an old
snapshot; failed refresh preserves previously admitted access and has a short
retry cooldown. Explicit replacement/removal closes idle clients immediately;
an already dispatched operation settles once before its retired client closes.
Unknown writes are never replayed. Current enable, generation and schema identity
are checked again before execution. Old chat catalogs can still display stale
names until their provider refreshes or starts a new chat; disabled calls are
blocked immediately.

## Verification

Focused fixtures cover the complete roster, transport setup, host RPC, real
in-memory MCP calls, native Google operations, callback composition, single-use
exchanges, refresh guards, hosted collection/revocation, old grants/labels/IDs,
corruption isolation, safe summaries, stale revisions, draft lifecycle and
resource cleanup. They use synthetic credentials and vendor adapters.

The app acceptance journey exercises the real registered Settings page, all 30
catalog entries, search clearing, a real loopback MCP fixture, OS-vault persistence,
tool selection, peer conflict/reload, disable and removal on wide and compact
layouts. CI owns an isolated D-Bus keyring and fixture-only data. It does not use
publisher vendor accounts or the user's machine. Native desktop/mobile visual
acceptance and unrelated-account vendor approval remain distinct from these
automated checks. No feature is declared delivered from a catalog row alone.
