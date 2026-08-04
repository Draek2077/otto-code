# Connectors

A connector is an MCP server presented to the user as a named integration with a
switch, not as a command line. The user picks Notion from a list, signs in, and
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

### The four shapes real vendors actually need

`oauth` above means "fixed URL plus dynamic client registration", which is what
the broker implements. Per-vendor research found that assumption covers barely
half the ecosystem. The other shapes, and who needs them:

| Shape                                    | What the user supplies                  | Vendors                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed URL + DCR                          | nothing                                 | Slack, Notion, Linear, Atlassian, monday.com, Box, Airtable, Dropbox, ClickUp, Trello, HubSpot, Stripe, GitHub, Sentry, Supabase, Cloudflare, Vercel, Square, Intercom, Canva, Figma, Webflow, Ahrefs, Netlify |
| Fixed URL + **own client ID and secret** | two pasted values from a vendor console | all of Google Workspace (Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat, People)                                                                                                                           |
| **Templated URL** + a variable           | tenant, host, store, region, or org URL | Microsoft 365, GitLab, Shopify, Datadog, AWS, Salesforce, Microsoft Ads                                                                                                                                        |
| **Client credentials** grant             | client ID and secret, no browser        | PayPal                                                                                                                                                                                                         |
| Static API token, no OAuth               | one token                               | Bitbucket tools on the Atlassian endpoint                                                                                                                                                                      |

The lesson is that "sign in and you're done" is the goal, not a universal
property of the ecosystem. A connector that needs a tenant ID still beats one
that needs a hand-typed command, so the shapes exist to keep every vendor on the
"provide credentials, never configuration" side of the line.

Two vendors (Vercel and Square) gate their endpoint to MCP clients they have
reviewed, so they can refuse Otto for reasons unrelated to the user's account.
The verification gate surfaces what they actually said.

### Everything configures from the Connectors UI

**No connector may require editing a config file, running a terminal command, or
leaving Otto except to click through a vendor's own consent screen.**

That is the whole point of the subsystem, and it is the line that decides whether
a shape above is acceptable. A connector needing a tenant ID is fine, because the
UI can ask for it. A connector needing you to hand-write a command is not.

The shapes are served by one mechanism: a connector declares an ordered list of
setup fields (text, secret, or choice), each with a label, help text, and an
`issueUrl` linking to the exact vendor page that issues that value. The UI renders
them, and the daemon substitutes them into both the endpoint template and the
auth flow. The browser half is the OAuth broker below.

`issueUrl` is not decoration. A field that asks for a client secret without
saying where to get one has handed the user homework, which is the original sin
this subsystem was rebuilt to remove.

## Otto-native connectors

When a service we need has no official MCP server, we write one. "No official
server" is a statement about a vendor's roadmap, not about what is possible:
every such service still has a documented REST API.

The mechanism is `InMemoryTransport.createLinkedPair()` from the MCP SDK. The
daemon hosts the server **in its own process** and connects a client to it over
memory, with no subprocess, port, or network hop. Downstream nothing changes:
tool namespacing, per-tool disable, permission gating and the verification gate
all see an ordinary MCP client. We write the API wrapper and inherit the rest of
the subsystem free.

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

Preferred loopback port is 6871, falling back to an ephemeral port when taken. A
stable redirect URI lets a second login reuse the first login's registration; a
registration bound to a different URI is discarded rather than reused, because
the authorization server rejects the mismatch at the authorize step.

### Interactive versus silent

The same provider class serves both paths, distinguished by whether an
`onRedirect` callback was supplied.

- **Interactive** (the Connect button) captures the authorization URL so the UI
  can open it.
- **Silent** (the agent path, at MCP connect time) refreshes an expired access
  token transparently, and **throws** if the server demands a full re-login. An
  agent mid-turn must never pop a browser nobody asked for.

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

| Path                                                            | What it holds                                |
| --------------------------------------------------------------- | -------------------------------------------- |
| `packages/app/src/screens/settings/connectors-catalog.ts`       | The catalog. Citations required              |
| `packages/app/src/screens/settings/connectors-section.tsx`      | Browse, install, verify, per-tool toggles    |
| `packages/server/src/server/connectors/connector-oauth.ts`      | The broker and the SDK's storage callbacks   |
| `packages/server/src/server/connectors/connector-auth-store.ts` | The daemon-scoped credential store           |
| `packages/server/src/server/connectors/connector-tools.ts`      | Live connect and enumerate                   |
| `packages/server/src/server/daemon-config-store.ts`             | Redaction and the one write path into `auth` |
