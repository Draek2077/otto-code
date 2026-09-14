# Connectors

A connector is a named integration whose tools execute on the host, using a
vendor MCP server or Otto-owned service API tools. The user picks Notion from a list, signs in, and
Notion's tools are available to agents. They never learn what MCP is.

Two rules carry this subsystem. Both exist because the first version broke them.

## Rule 1: an entry is real or it is not an entry

`packages/app/src/screens/settings/connectors-catalog.ts` shipped once with about
seventy entries whose command was the literal string `npx -y <slug-mcp-server>`,
angle brackets included. Every one rendered as a working integration and none
could start. The file's own header said the values were "starting points" the
user should confirm against vendor docs, which is a directory of homework
wearing the costume of a directory of connectors.

So: every catalog entry carries a `source` (the vendor doc it came from) and a
`verifiedOn` date. No citation, no entry. `connectors-catalog.test.ts` enforces
this, plus the absence of placeholder syntax anywhere in an endpoint.

Breadth that does not run is worse than a short list that does, because it costs
the user the time to discover the difference. The catalog is deliberately small.
When a vendor publishes a real endpoint, add it with its citation. Never add a
label with a guessed package name.

Several of the obvious reference packages (`@modelcontextprotocol/server-github`,
`-slack`, `-postgres`, `-gdrive`, `-sqlite`) are **archived upstream**. Shipping
them points users at abandoned code. Check before assuming a package name is
current: every one of those has a live vendor endpoint replacement.

The SQLite one is worse than abandoned. It carries an unpatched SQL injection
flaw, the repository is frozen so it cannot be fixed, and it still takes roughly
thirteen thousand downloads a week. **Do not ship it.** If we want SQL coverage,
Bytebase DBHub covers Postgres, MySQL, MariaDB, SQL Server and SQLite behind one
maintained server.

The inverse error is just as costly. After the placeholder catalog was cut back,
vendors were dropped as "no official server" on the strength of a single broad
sweep that had simply missed them. Slack, HubSpot, monday.com, Box, Airtable,
Dropbox, ClickUp, Trello, Ahrefs, Netlify and Square all publish official
endpoints. **Absence of evidence is not evidence of absence: check the vendor's
own developer docs per connector before recording one as unavailable**, and log
the negative result so the next person does not redo the search. That ledger is
[projects/connectors/connectors.md](../projects/connectors/connectors.md).

Treat a `verifiedOn` older than about six months as unverified. These are third
party endpoints and they move.

## Rule 2: the user provides credentials, never configuration

Three setup shapes, in order of preference:

| `setup.kind` | What the user does                                             | When to use it                                 |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| `oauth`      | Clicks Connect, logs in on the vendor's page                   | Default. Any vendor with a remote MCP endpoint |
| `token`      | Pastes one secret, with a deep link to the page that issues it | Only when the vendor offers no OAuth endpoint  |
| `none`       | Nothing                                                        | Servers that need no account                   |

A `token` entry must carry `credential.issueUrl`. Asking for a credential without
saying where to get it is the failure this catalog was rebuilt to remove.

### Shared hosted authentication

Box and HubSpot use Otto's shared confidential-client authentication service. Their authorization
servers do not offer dynamic client registration. The publisher secret stays in
the service; per-user credentials stay in the host vault. The implementation is
capability-gated and requires a verified publisher deployment before ordinary users
can sign in. See [shared authentication](connector-auth-service.md) for ownership,
security disclosures, lifecycle behavior and deployment instructions. Existing direct
OAuth connectors keep their current authentication paths.

### The four shapes real vendors actually need

The generic broker supports fixed URLs with dynamic client registration and
publisher-owned public registrations for remote MCP servers such as Slack. Google
uses Otto's publisher-owned Desktop OAuth registration and ordinary APIs. The
remaining shapes below describe vendor requirements, not implemented support:

| Shape                          | What the user supplies                  | Vendors                                                                                                                                                                   |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed URL + DCR                | nothing                                 | Notion, Linear, Atlassian, monday.com, Airtable, ClickUp, Trello, Stripe, GitHub, Sentry, Supabase, Cloudflare, Vercel, Square, Intercom, Canva, Webflow, Ahrefs, Netlify |
| Registered public client + MCP | account sign-in                         | Slack (internal workspace verified; Marketplace distribution pending)                                                                                                     |
| Publisher-owned Desktop OAuth  | nothing beyond account sign-in          | Google Drive, Gmail and Calendar                                                                                                                                          |
| **Templated URL** + a variable | tenant, host, store, region, or org URL | Microsoft 365, GitLab, Shopify, Datadog, AWS, Salesforce, Microsoft Ads                                                                                                   |
| **Client credentials** grant   | client ID and secret, no browser        | PayPal                                                                                                                                                                    |
| Static API token, no OAuth     | one token                               | Bitbucket tools on the Atlassian endpoint                                                                                                                                 |

The lesson is that "sign in and you're done" is the goal, not a universal
property of the ecosystem. A connector that needs a tenant ID still beats one
that needs a hand-typed command, so the shapes exist to keep every vendor on the
"provide credentials, never configuration" side of the line.

Two vendors (Vercel and Square) gate their endpoint to MCP clients they have
reviewed, so they can refuse Otto for reasons unrelated to the user's account.
The verification gate surfaces what they actually said.

Figma is excluded from the catalog until Otto can connect as an approved client.
Its registration endpoint rejects Otto with HTTP 403, and Figma has paused new
client approvals. Restore the entry only after approval and successful sign-in
and tool enumeration. See [Figma's access policy](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

Dropbox uses Otto's publisher-owned public app registration with PKCE, bypassing
its trusted-client-only dynamic registration endpoint. Its registered callback is
`http://127.0.0.1:6872/connectors/oauth/callback`; it uses a separate port from
Slack's callback. The registration requests Dropbox's eight published MCP scopes
and `token_access_type=offline` for refresh tokens. No app secret is distributed.
End users sign in to Otto's app rather than registering their own.

The September 2026 live source check completed consent, enumerated 25 tools,
refreshed the grant, and called `who_am_i` successfully. The portal app remains
in Development with access limited to its owner. This proves owner-account MCP
access, not public distribution. Installed hosts need the registered-client code
before their normal Sign in action uses this path. See
[Dropbox's supported clients and app setup](https://help.dropbox.com/integrations/connect-dropbox-mcp-server).

### Everything configures from the Connectors UI

**No connector may require editing a config file, running a terminal command, or
leaving Otto except to click through a vendor's own consent screen.**

That is the whole point of the subsystem, and it is the line that decides whether
a shape above is acceptable. A connector needing a tenant ID is fine, because the
UI can ask for it. A connector needing you to hand-write a command is not.

Implemented catalog setup kinds are `oauth`, `token` and `none`. Google OAuth
entries additionally declare a `builtin` service identifier. Their install panel
has a Connect button. Client registration belongs to the publisher, never the
user. General tenant templates and client-credentials grants remain unbuilt.

`issueUrl` is not decoration. A field that asks for a client secret without
saying where to get one has handed the user homework, which is the original sin
this subsystem was rebuilt to remove.

### Two surfaces, not one list

The Connectors settings section is the ledger of what this host has: one card per
installed connector, its enable switch, its tools, and a tally in the section
header. The catalog is not in it. Browsing and installing happen in the add sheet
(`AddConnectorSheet`), which is a centred dialog on desktop and a bottom sheet on
mobile, with search in the sheet header and the audience filter pinned under it.

The split is the point. Inline browsing put a few dozen catalog rows above the
two or three connectors the user actually runs, so the thing they came to check -
what is on - was the hardest thing on the page to find. Keep it: the section
answers "what do I have and is it on", the sheet answers "what could I add".

Both surfaces use `ConnectorIdentity` for a bundled monochrome SVG beside the name,
with descriptions and status aligned beneath the name. Brand marks follow the theme's
foreground and icon-size tokens; the icon keeps its size when text wraps. Local files
uses the folder glyph, Persistent memory uses the database glyph, and custom connector
ids use the plug glyph. Native Google connectors retain their service mark through their
`builtin` identity. Artwork sources and licenses live beside the bundled assets in
`packages/app/src/assets/connector-brand-icons.NOTICE.md`; no icon fetches occur at runtime.

## Otto-native connectors

When a service we need has no official MCP server, we write one. "No official
server" is a statement about a vendor's roadmap, not about what is possible:
every such service still has a documented REST API.

Native connectors contribute `OttoToolDefinition` objects to the existing shared
tool catalog. Native providers execute that catalog directly; MCP providers see
it through Otto's internal MCP server. API execution, credentials, result limits
and live enable checks stay in the daemon. The renderer owns presentation.

These are marked by an optional `builtin` field on `ConnectorConfig`, not by a
new branch on `McpServerConfigSchema`. That union is discriminated on `type`, so
a new branch would make an old client fail to parse a new daemon's entire config
and break the backward-compatibility contract. `builtin` rides alongside a
`server` value that still parses everywhere. Tagged `COMPAT(connectorBuiltin)`.

**The cost is real and asymmetric.** Adding a vendor URL to the catalog is free.
An Otto-native connector is code we own forever: API drift, pagination, rate
limits, token refresh, token economy, tests. Write one because the integration is
needed, never because it is possible.

Per-service API research (endpoints, scopes, gotchas) lives in
[projects/connectors/connectors.md](../projects/connectors/connectors.md) section 7.
The first target is Google Search Console, whose `searchAnalytics.query` can
return 25,000 rows in one call. Low default row limits and compact aggregates are
part of the initial design, not a later optimization. See
[token-economy.md](token-economy.md).

Transports, commands, and URLs still exist in the UI, but only behind **Add
custom connector**, where the user is deliberately configuring a server Otto does
not ship and has its docs open. That is no longer the default path.

## The OAuth broker

`packages/server/src/server/connectors/connector-oauth.ts`.

The MCP SDK owns the protocol: RFC 9728 discovery, dynamic client registration,
PKCE, code exchange, refresh. The broker owns the three application-defined
pieces the SDK calls back into.

1. **Storage.** Tokens and the client registration persist in daemon config under
   the connector's `auth` block.
2. **Redirect.** The daemon starts a loopback HTTP listener for the duration of
   one login (RFC 8252). It is **not** routed through the daemon's own HTTP
   server: that server is not always bound to loopback (WSL auto-bind), and an
   authorization code arriving on a LAN-reachable interface is a code someone
   else can race for.
3. **The return.** The listener validates the `state` parameter, then resumes the
   exchange.

The generic MCP broker prefers loopback port 6871, falling back to an ephemeral
port when taken. Google Desktop OAuth uses a separate ephemeral listener. A
stable redirect URI lets a second login reuse the first login's registration; a
registration bound to a different URI is discarded rather than reused, because
the authorization server rejects the mismatch at the authorize step.

The callback exchanges its code once, using the discovery result and client
registration that started consent. It uses the SDK's token exchange directly:
the SDK's full authorization helper retries rejected clients after deleting their
registration, which hides the original rejection behind a missing-client error.
Otto reports the original OAuth error with credentials redacted. If the client
was rejected, the next Connect or Reconnect starts fresh consent, dynamically
registering again where applicable. Otto never retries the old code against a
new client.

### Webflow endpoint and HubSpot registration

Webflow uses `https://mcp.webflow.com/mcp`. Its origin root serves HTML, including
for MCP POST requests, so successful browser consent alone cannot validate that
address. The daemon repairs saved HTTP entries pointing exactly at that root on
startup, settings save and reload. It preserves connector identity and tool
preferences and discards the old OAuth grant so the corrected resource receives
fresh consent. Custom paths and current `/mcp` grants are unchanged. See
[Webflow's setup guide](https://developers.webflow.com/mcp/reference/getting-started).

HubSpot is not a dynamic-registration connector. Its published MCP setup requires
an MCP auth app with a client ID, confidential client secret and registered
redirect URL, plus PKCE. Live discovery on September 13, 2026 advertised
`client_secret_post` and no registration endpoint. The current generic OAuth
path cannot complete that setup. Otto routes HubSpot through its shared
authentication service, which requires publisher runtime bindings
`HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`. Each sign-in generates fresh PKCE;
users do not generate values in HubSpot's Installation URL Builder. HubSpot's
consent page determines scopes, and Otto accepts its bounded `scopes` array or
standard `scope` string without inventing permissions. End users are never asked
for publisher secrets. The production service and developer-account flow were
verified with 28 tools, an account-details read, refresh and revocation. The host
defaults to the deployed service; installed apps need a host build containing
this integration. Verification used a temporary in-memory vault; packaged
desktop sign-in and unrelated-account distribution remain unverified.
See [HubSpot's MCP integration guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server).

### Slack's registered public client

Slack does not support dynamic client registration. The broker selects Otto's
publisher-owned public client from `connector-oauth-registration.ts` by the exact
HTTP endpoint `https://mcp.slack.com/mcp`, never by the connector's editable name
or id. The existing MCP SDK still owns discovery, PKCE, exchange and refresh.
No client secret is packaged or requested from the user.

The registration and scope bundle compile into `connector-oauth-registration.js`
beside `connector-oauth.js` in the server package's existing `dist/server` payload.
Slack needs no separate JSON asset, environment variable, or copy step. Desktop
`afterPack` checks both files inside the actual `app.asar` and compares their bytes
with the freshly built daemon output, failing packaging if either is missing,
empty, or stale.

The registered callback is `http://127.0.0.1:6871/connectors/oauth/callback`.
If that port is busy, Slack sign-in fails with an actionable message instead of
selecting an unregistered port. The provider validates discovered authorization
and token endpoints against the registration. Saved credentials bind to that
endpoint, client id and callback; credentials from a different app are not reused.
OAuth requests use the explicit portal-approved user scope bundle in code, so a
vendor metadata change cannot silently expand the next consent request.

Publisher setup in Slack's app settings enables **Slack Model Context Protocol
(MCP) Server** and **PKCE**, configures the callback, and installs the app in the
workspace. Enabling MCP adds Slack's standard scope bundle. **Agent experience**
is separate: it is for an assistant conversation inside Slack and is not needed
for Otto's connector. End users only sign in through Otto.

The September 2026 live check completed a fresh PKCE exchange and enumerated 27
tools from Slack's official MCP server in the Otto: Code workspace. The app is
internal; this does not prove general distribution. Slack permits internal or
Marketplace-published MCP apps, and Marketplace publication remains a release
prerequisite for other workspaces. See [Slack MCP app requirements](https://docs.slack.dev/ai/slack-mcp-server/)
and [desktop PKCE](https://docs.slack.dev/authentication/using-pkce/).

### Interactive versus silent

The same provider class serves both paths, distinguished by whether an
`onRedirect` callback was supplied.

- **Interactive** (the Connect button) captures the authorization URL so the UI
  can open it.
- **Silent** (the agent path, at MCP connect time) refreshes an expired access
  token transparently, and **throws** if the server demands a full re-login. An
  agent mid-turn must never pop a browser nobody asked for.

Opening the vendor site or creating an account does not complete authorization.
The add panel distinguishes opening the browser from waiting for access approval,
and offers **Open sign-in page** while waiting. This lets a user who landed in a
new vendor workspace return to consent without removing the connector. Only the
daemon callback followed by successful tool enumeration completes setup.

Installed OAuth connectors expose **Connect**, **Reconnect**, and **Disconnect**
using the same sign-in helper as the add panel. A saved catalog OAuth entry with
no token presence is labelled **Sign-in incomplete**. Closing its install panel
cancels the local wait and runs the existing incomplete-install cleanup; browser
opening failures and authorization timeouts also release the status subscription.

### Browser authorization lifecycle

Browser sign-in is daemon-owned infrastructure, not a connector-specific UI
pattern. New native integration drivers register with
`IntegrationBrowserAuthorizationService` and Settings starts them through the
provider-neutral `integrations.authorization.start_browser.request` RPC. The
driver owns vendor protocol details (OAuth shape, PKCE, redirect URI, and
account lookup); the shared layer owns attempt replacement and the safe client
boundary.

### Scope contract

Every OAuth integration maintains three adjacent declarations: the vendor
portal's approved scope inventory, the scopes Otto requests for the current
release, and the scope required by each REST operation actually called. The
test contract requires every active operation to be both portal-approved and
requested by OAuth.

Vendor portals do not expose a safe general-purpose API for Otto to inspect an
app's private configuration at runtime. Changing scopes is therefore a
deliberate release operation: update the portal, update the approved inventory
and operation map in code, then require the user to authorize again. A scope
that is merely approved for future work is not requested until its capability
is implemented.

`BrowserAuthorizationAttemptManager` treats a second sign-in as an intentional
replacement: it closes only Otto's earlier callback listener and discards its
in-memory verifier. It never closes a browser, browser tab, or vendor session.
A callback from an earlier attempt is rejected without cancelling the current
one. A persisted `authorizing` connection state is not proof that a browser is
still open, so a fresh Settings page must allow the user to start a replacement
attempt.

The established connector OAuth broker follows the same stale-callback rule.
Its redirect listener can choose an ephemeral port when the server supports a
dynamic redirect URI. A provider with a registered fixed redirect URI, such as
the current Zoom public-client proof, must instead report a local listener
collision clearly; it cannot silently switch ports until that provider's app
registration permits the alternate URI.

`resolveEnabledConnectors` attaches a provider only for connectors that hold
tokens, so unauthenticated servers stay on the plain no-auth path.

### Why this was the load-bearing piece

Before it, `openai-compat-mcp.ts` built HTTP and SSE transports with static
headers only and never passed an `authProvider`. Every OAuth-protected remote
server answered 401 on every request. Without the broker, an honest catalog
collapses to a handful of paste-a-token entries, because the vendors worth having
all authenticate by login.

## Verification is a gate, not a decoration

Adding a connector runs add, then authorize (if it signs in), then **connect and
enumerate**. The UI reports "17 tools available" or the actual error text from
the server. Nothing enters the list unverified.

This is the check that would have caught the placeholder catalog on day one, and
it is why `listConnectorTools` now takes an auth store: enumerating a signed-in
connector without its token reports 401 for a connector that works.

Some endpoints legitimately refuse Otto. Vercel gates its MCP server to clients
it has reviewed. The gate surfaces what the vendor actually said rather than
pretending the connection succeeded.

## Google Drive, Gmail and Calendar

Otto implements these services over their ordinary account APIs. Users choose a
service in **Settings > Connectors > Add connector**, click Connect,
sign in and approve access. They need no client registration or preview setting.
The callback currently requires a browser on the host computer; remote phone
consent is not implemented. Start or reload a chat after changing connections.

| Service  | Operations                                                             | Requested scopes (Google auth prefix omitted)       |
| -------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Gmail    | List/search, read, draft, send, reply, forward                         | `gmail.readonly`, `gmail.compose`                   |
| Drive    | List/search, read/export text, create text files, replace file content | `drive`                                             |
| Calendar | List calendars, list events, read an event, create an event            | `calendar.calendarlist.readonly`, `calendar.events` |

Every login also requests `openid` and `userinfo.email` for a verified account
label. Drive writes cover ordinary UTF-8 files; native Docs/Sheets/Slides editing
and binary transfers are not implemented. Pagination is explicit (25 by default,
100 maximum). Email bodies, file text, HTTP responses and final tool results are
bounded. Writes are never retried automatically because a timeout can follow a
successful send or creation. Sending or forwarding mail requires user instruction.

### Daemon ownership and publisher configuration

`GoogleConnectorAuthorization` registers with the shared integration browser
authorization service. It uses PKCE, state validation and a short-lived loopback
listener. The common `IntegrationAuthorizationService` persists tokens in the OS
credential vault and exposes only status, scopes and the account label. Tokens
never enter app state, provider launch configuration or the generic connector
`auth` block. Refresh and disconnect are serialized per connection; a superseded
callback cannot restore a disconnected grant. Removal reconciles vault entries.
Disconnect clears Otto's local grant; it does not revoke the app at Google.

The publisher creates a **Desktop app** OAuth registration, enables the regular
Gmail/Drive/Calendar APIs and maintains the consent screen's scope inventory.
Google's token exchange requires that registration's generated client secret.
A desktop registration is distributed application identity, not a confidential
server credential. End-user tokens remain separate in the vault.

Builds copy the publisher registration from `OTTO_GOOGLE_OAUTH_CLIENT_FILE` or
`OTTO_GOOGLE_OAUTH_CLIENT_JSON` into the daemon package with
`scripts/copy-google-oauth-client.mjs`. These are publisher build inputs, never
end-user settings. Desktop release jobs supply JSON through the repository secret
`OTTO_GOOGLE_OAUTH_CLIENT_JSON`; publishing builds set
`OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT=1` and fail if registration is missing. Only the
desktop client ID and client secret enter the package. Incremental builds remove
stale registration assets before processing the current input.

A development build without registration does not advertise
`server_info.features.connectorNativeGoogle`; the client explains that Google
sign-in is unavailable in this host build. This capability reflects registration
availability as well as implementation support, so a missing capability does not
by itself prove the host version is old. The old caller-supplied registration RPC shape remains
parseable for compatibility but is rejected.

Public release requires publisher registration packaging and Google's required
OAuth verification. A Testing consent screen only admits listed test users.
Enabling APIs and completing a developer login do not prove public readiness.
See [Google's native app OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app).

### Hosted MCP backend

`GoogleMcpBackend` is an alternative daemon backend, selected by host construction
policy, not a user knob. It consumes Google's live catalog and JSON schemas at
`https://gmailmcp.googleapis.com/mcp/v1`,
`https://drivemcp.googleapis.com/mcp/v1`, and
`https://calendarmcp.googleapis.com/mcp/v1`. Changing backend changes the vendor
operation names and can require additional scopes; it is a release decision.
There is no automatic retry or switch after a failed write.

Google's public `tools/list` does not prove account access. Admission performs a
read-only tool call before exposing hosted tools. The September 2026 live check
returned 23 Gmail, 8 Drive and 9 Calendar definitions, but authenticated Gmail
and Calendar calls required Developer Preview enrollment, and Drive denied
access. The equivalent REST reads succeeded. Hosted Gmail's catalog had draft
creation but no send operation; it cannot currently replace the full REST set.
See the [Workspace MCP setup guide](https://developers.google.com/workspace/guides/configure-mcp-servers)
and [Developer Preview requirements](https://developers.google.com/workspace/preview).

### Open-source reuse

`vendor/activepieces-mail.ts` adapts the MIT-licensed Gmail MIME, reply and forward
helpers from pinned Activepieces commit `89aeeae8c1eb98428210ec7d214f933b96aa1987`.
It retains the license and records Otto's changes. Nodemailer and Mailparser
handle MIME encoding and parsing. Otto owns the operation schemas and API
adapters; the Activepieces workflow engine is not a runtime dependency.

## One tool catalog for every provider

`ConnectorToolCatalogService` owns the connector MCP clients in the daemon.
Bound agents receive enabled connector tools through the shared Otto tool
catalog. Brain, OpenAI-compatible and OMP use that catalog natively; Claude,
Codex, OpenCode and ACP use the internal Otto MCP server. Pi requires its MCP
adapter. The host's Otto-tool injection must be enabled. Unbound control-plane
clients and voice-only catalogs do not receive external account tools.

Every provider receives the same namespaced vendor tools and schemas. Connector
enable/per-tool switches apply independently of Otto's internal tool groups.
Calls check live settings again, so a stale chat cannot call a disabled or
removed tool. Google credentials remain in the daemon, never in provider launch
configuration. Agents still follow their provider's tool permission policy.

Enumeration follows MCP pagination. Connections are shared across providers;
stdio connectors remain scoped to the agent's working directory. Idle clients
are closed after five minutes, and later calls reconnect. Catalog snapshots
refresh on subsequent construction after five minutes, with a shorter retry
for failed connections. Existing chats must reload to discover newly added
tools. Unsupported input schemas fail verification instead of silently dropping
part of a connector's catalog.

Verification and agent exposure share the same input-schema conversion. Local
JSON Pointer references into nested properties or array items are relocated to
root definitions before conversion, preserving shared and recursive schemas.
This supports schemas such as monday.com's `create_form_submission`, whose
signature answer reuses its file-answer schema. Unresolved and external
references still fail verification.

Local tests cover Google consent parameters, loopback callbacks, refresh,
endpoint binding, paginated MCP discovery, native/MCP schema parity, reconnects
and live disable checks. They use fixture servers and mocked token responses.
They do not prove a Google account's preview enrollment, Cloud configuration or
end-to-end calls from each installed provider; those require live account tests.

## Secrets

Connector credentials are host-owned and never sent to a client.

`SECRET_WIRE_PATHS` in `daemon-config-store.ts` is a flat dotted-path list and
**cannot address an array**, so connectors were exempt from redaction entirely
and every pasted token was echoed to every connected client. `redactConnectorsForClient`
closes that. Two mechanisms, deliberately different:

- **env and header values** round-trip through `DAEMON_CONFIG_SECRET_SENTINEL`.
  The user owns them and may legitimately re-type one.
- **`auth` is daemon-owned.** It is masked outbound down to presence and account
  label, and on the way in it is discarded and replaced with whatever the daemon
  holds. A client cannot mint, alter, or clear an authorization by saving
  settings. The only door into `auth` is `DaemonConfigStore.setConnectorAuth`,
  which the broker calls.

`connector-secrets.test.ts` covers both directions, including the case that
matters most: a client echoing the redacted config back must not log the user
out.

## Capability gating

`server_info.features.connectorOauth`. Old daemons have no broker and nowhere to
hold a token, so the client hides Connect and Disconnect and offers only the
paste-a-token entries. Tagged `COMPAT(connectorOauth)`, added in v0.7.7.

## Files

| Path                                                                      | What it holds                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/app/src/screens/settings/connectors-catalog.ts`                 | The catalog. Citations required                         |
| `packages/app/src/screens/settings/connectors-section.tsx`                | Installed connectors, enable and per-tool toggles       |
| `packages/app/src/screens/settings/connectors-add-sheet.tsx`              | Browse, install, verify; the by-hand form               |
| `packages/app/src/screens/settings/connectors-shared.ts`                  | Capability gates, the OAuth wait, form chrome           |
| `packages/server/src/server/connectors/connector-oauth.ts`                | The broker and the SDK's storage callbacks              |
| `packages/server/src/server/connectors/connector-auth-store.ts`           | The daemon-scoped credential store                      |
| `packages/server/src/server/connectors/connector-tools.ts`                | Live connect and enumerate                              |
| `packages/server/src/server/connectors/connector-tool-catalog.ts`         | Shared connector clients and provider tool definitions  |
| `packages/protocol/src/google-connectors.ts`                              | Native Google service identities and requested scopes   |
| `packages/app/src/screens/settings/connectors-google-auth.tsx`            | Google reconnect and disconnect actions                 |
| `packages/server/src/server/connectors/google-connector-authorization.ts` | Google driver on the shared authorization platform      |
| `packages/server/src/server/connectors/google-connector-service.ts`       | Native Google catalog, verification and live call gates |
| `packages/server/src/server/connectors/google-gmail-tools.ts`             | Gmail operations and MIME integration                   |
| `packages/server/src/server/connectors/google-drive-tools.ts`             | Drive text operations                                   |
| `packages/server/src/server/connectors/google-calendar-tools.ts`          | Calendar operations                                     |
| `packages/server/src/server/connectors/google-mcp-backend.ts`             | Hosted Google MCP adapter and admission probe           |
| `packages/server/src/server/daemon-config-store.ts`                       | Redaction and the one write path into `auth`            |
