---
id: "connectors"
kind: "project"
title: "Connectors"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:20.615Z"
updated_at: "2026-08-08T06:19:42.485Z"
---

# Connectors

<!-- compiled_truth -->

# Connectors: the verified vendor ledger

Status: research complete. **Section 1 has shipped: 29 connectors are selectable
today** (25 sign-in, 4 needing no account). Four setup shapes remain unbuilt,
which is the only thing holding back section 2.

Meta Ads is the one section 1 row that did NOT ship. `mcp.facebook.com/ads` was
reported without a scheme or trailing path, and the catalog rule is that an
unverified endpoint does not get an entry. It goes in the moment someone reads it
off Meta's own docs.

This is the working record of **every connector we have considered, what was actually
found, and what is still needed to ship it**. It exists because the first catalog
shipped about seventy entries whose command was the literal string
`npx -y <slug-mcp-server>`, and the correction to that overshot: a broad sweep
failed to find several vendors and they were cut as "no official server", when in
fact most of them have one. Absence of evidence got recorded as evidence of
absence. This file is the audit trail that stops both mistakes.

Durable design rules live in [docs/connectors.md](../../docs/connectors.md). This
page is the point-in-time ledger: verdicts, gather lists, open questions.

All entries verified 2026-08-03 unless noted.

---

## 1. Ready to ship: fixed endpoint, OAuth, no extra input

These work with the broker exactly as built (dynamic client registration plus
PKCE against a fixed URL). Nothing needed from anyone.

| Connector         | Endpoint                              | Notes                                                                                                             | Source                                                   |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Notion            | `https://mcp.notion.com/mcp`          | shipped                                                                                                           | developers.notion.com/docs/mcp                           |
| Jira & Confluence | `https://mcp.atlassian.com/v1/mcp`    | shipped. `/v1/sse` retired after 2026-06-30                                                                       | atlassian.com/blog/announcements/remote-mcp-server       |
| Linear            | `https://mcp.linear.app/mcp`          | shipped                                                                                                           | linear.app/docs/mcp                                      |
| Asana             | `https://mcp.asana.com/sse`           | shipped. SSE; confirm whether an `/mcp` twin now exists                                                           | developers.asana.com                                     |
| Canva             | `https://mcp.canva.com/mcp`           | shipped                                                                                                           | canva.dev/docs/connect/mcp-server/                       |
| Figma             | `https://mcp.figma.com/mcp`           | shipped                                                                                                           | developers.figma.com                                     |
| Webflow           | `https://mcp.webflow.com/`            | shipped                                                                                                           | developers.webflow.com/data/docs/ai-tools                |
| Intercom          | `https://mcp.intercom.com/mcp`        | shipped                                                                                                           | developers.intercom.com/docs/guides/mcp                  |
| Stripe            | `https://mcp.stripe.com`              | shipped                                                                                                           | docs.stripe.com/mcp                                      |
| GitHub            | `https://api.githubcopilot.com/mcp/`  | shipped                                                                                                           | github.com/github/github-mcp-server                      |
| Sentry            | `https://mcp.sentry.dev/mcp`          | shipped                                                                                                           | docs.sentry.io/product/sentry-mcp/                       |
| Supabase          | `https://mcp.supabase.com/mcp`        | shipped                                                                                                           | supabase.com/docs/guides/ai-tools/mcp                    |
| Cloudflare        | `https://mcp.cloudflare.com/mcp`      | shipped                                                                                                           | developers.cloudflare.com/agents/model-context-protocol/ |
| Vercel            | `https://mcp.vercel.com`              | shipped. Gated to clients Vercel has reviewed; may refuse Otto                                                    | vercel.com/docs/agent-resources/vercel-mcp               |
| **Slack**         | `https://mcp.slack.com/mcp`           | shipped                                                                                                           | docs.slack.dev/ai/slack-mcp-server/                      |
| **HubSpot**       | `https://mcp.hubspot.com`             | shipped. GA since Apr 2026                                                                                        | developers.hubspot.com/mcp                               |
| **monday.com**    | `https://mcp.monday.com/mcp`          | shipped. Documents DCR explicitly                                                                                 | developer.monday.com                                     |
| **Box**           | `https://mcp.box.com`                 | shipped                                                                                                           | developer.box.com/guides/box-mcp                         |
| **Airtable**      | `https://mcp.airtable.com/mcp`        | shipped. PAT also supported                                                                                       | support.airtable.com                                     |
| **Dropbox**       | `https://mcp.dropbox.com/mcp`         | shipped. Open beta since Mar 2026                                                                                 | help.dropbox.com                                         |
| **ClickUp**       | `https://mcp.clickup.com/mcp`         | shipped. Public beta, all plans                                                                                   | mcp.clickup.com                                          |
| **Trello**        | `https://mcp.trello.com/v1`           | shipped. Workspace-scoped consent, any plan                                                                       | github.com/atlassian/trello-mcp-server                   |
| **Ahrefs**        | `https://api.ahrefs.com/mcp/mcp`      | shipped                                                                                                           | github.com/ahrefs/ahrefs-mcp-server                      |
| **Netlify**       | `https://netlify-mcp.netlify.app/mcp` | shipped                                                                                                           | docs.netlify.com                                         |
| **Square**        | `https://mcp.squareup.com/sse`        | shipped. Beta; gated to approved clients like Vercel                                                              | developer.squareup.com/docs/mcp                          |
| **Meta Ads**      | `mcp.facebook.com/ads`                | **HELD BACK**. Open beta since 2026-04-29, but the scheme and path are unconfirmed, so it fails the citation rule | Meta announcement                                        |

---

## 2. Blocked on a new setup shape

Real, official, and verified. They cannot be expressed by the current
`ConnectorSetup` type, which only knows "fixed URL plus DCR". Each row names the
shape it needs.

### Shape A: user supplies their own OAuth client ID and secret

The vendor does not support dynamic client registration, so the user registers an
app once and pastes two values.

**Google Workspace.** Endpoints are exact and confirmed:

| Product  | Endpoint                                    |
| -------- | ------------------------------------------- |
| Gmail    | `https://gmailmcp.googleapis.com/mcp/v1`    |
| Drive    | `https://drivemcp.googleapis.com/mcp/v1`    |
| Docs     | `https://docsmcp.googleapis.com/mcp/v1`     |
| Sheets   | `https://sheetsmcp.googleapis.com/mcp/v1`   |
| Slides   | `https://slidesmcp.googleapis.com/mcp/v1`   |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |
| Chat     | `https://chatmcp.googleapis.com/mcp/v1`     |
| People   | `https://people.googleapis.com/mcp/v1`      |

Source: developers.google.com/workspace/guides/configure-mcp-servers. Auth is
OAuth 2.0 with a client ID and secret created in Google Cloud Console.

This is the single highest-value row in the ledger: eight connectors, one shape.

### Shape B: templated URL with a user-supplied variable

| Connector               | Template                                                                          | Variable                                      |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Microsoft 365 (Work IQ) | `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/{server}` | tenant ID, plus a client ID (shape A as well) |
| GitLab                  | `https://{host}/api/v4/mcp`                                                       | instance host                                 |
| Shopify                 | store's own domain                                                                | store domain                                  |
| Datadog                 | `https://mcp.datadoghq.com` or `.eu`                                              | site region                                   |
| AWS                     | `https://aws-mcp.{region}.api.aws/mcp`                                            | region (`us-east-1`, `eu-central-1` only)     |
| Salesforce              | per-org server URL from Setup                                                     | server URL, plus shape A                      |
| Microsoft Ads           | `https://partner.api.bingads.microsoft.com/ext/mcp/vnext?toolSetNames=OpenBeta`   | AAD client ID (shape A)                       |

Microsoft 365 servers confirmed available: Mail, Calendar, Teams, SharePoint,
OneDrive, Word, User, Copilot. Preview, and requires a Microsoft 365 Copilot
license.

### Shape C: client-credentials grant

| Connector | Endpoint                     | Note                                        |
| --------- | ---------------------------- | ------------------------------------------- |
| PayPal    | `https://mcp.paypal.com/sse` | Sandbox at `https://mcp.sandbox.paypal.com` |

Not the authorization-code flow. The SDK supports it through
`prepareTokenRequest`, so this is a provider change, not a new protocol.

### Shape D: static API token, no OAuth

| Connector | Endpoint                           | Note                                                                                                                                             |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bitbucket | `https://mcp.atlassian.com/v1/mcp` | Bitbucket tools are API-token only, not the OAuth browser flow. Org admin must enable them, and the workspace must be linked to an Atlassian org |

### Local servers (stdio), official, credential supplied at add time

These need no new shape beyond the existing `token` kind, but they are commands
rather than URLs.

| Connector        | Package / repo                         | Credential                                                                           |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| MongoDB          | `mongodb-mcp-server` (npm, official)   | connection string                                                                    |
| Redis            | `redis/mcp-redis` (official)           | connection string                                                                    |
| Grafana          | `grafana/mcp-grafana` (official)       | API token                                                                            |
| Kubernetes       | Red Hat `kubernetes-mcp-server`        | kubeconfig                                                                           |
| Google Analytics | `googleanalytics/google-analytics-mcp` | Google Cloud OAuth creds. Read-only, experimental                                    |
| Google Ads       | `googleads/google-ads-mcp` (pipx)      | 22-char developer token, GCP project, OAuth creds. Read-only, **no hosted endpoint** |
| TikTok Ads       | TikTok for Business MCP Server         | developer app App ID and Secret                                                      |
| Docker           | Docker MCP Gateway                     | this is a gateway, not a connector; probably out of scope                            |

---

## 3. No official server: do not add

Checked individually. Community implementations may exist; the catalog rule is
official-and-cited, so these stay out until a vendor ships one.

| Connector                   | Finding                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zendesk                     | Zendesk is an MCP **client**, not a server publisher. Community servers only                                                                                                                                                                            |
| Todoist                     | Community only                                                                                                                                                                                                                                          |
| Google Search Console       | Google ships Analytics, not GSC. Not on Google's official list                                                                                                                                                                                          |
| Google Business Profile     | Community only. API access also needs a 60-day-old verified profile                                                                                                                                                                                     |
| LinkedIn Ads                | No official server as of mid-2026                                                                                                                                                                                                                       |
| Reddit Ads                  | No official server                                                                                                                                                                                                                                      |
| StackAdapt                  | Nothing found                                                                                                                                                                                                                                           |
| CircleCI                    | Nothing found                                                                                                                                                                                                                                           |
| Apple Pages                 | Not applicable, no such API surface                                                                                                                                                                                                                     |
| Pinterest Ads               | Official server exists but is **alpha, named partners only**. Unusable for us today. Recheck later                                                                                                                                                      |
| PostgreSQL / MySQL / SQLite | Reference servers are **archived upstream**. The SQLite one has an unpatched SQL injection flaw and is still downloaded ~13k/week. **Do not ship it.** Use Bytebase DBHub (Postgres, MySQL, MariaDB, SQL Server, SQLite in one) if we want SQL coverage |

Also archived and not to be used: `@modelcontextprotocol/server-github`,
`-slack`, `-postgres`, `-gdrive`. The live replacements are the vendor endpoints
in section 1.

---

## 4. What Philippe needs to gather

One list, grouped by what a single gathering session unlocks.

**Google Cloud (unlocks 8 connectors plus Analytics and Google Ads)**

1. A Google Cloud project with the Gmail, Drive, Docs, Sheets, Slides, Calendar,
   Chat and People APIs enabled.
2. An OAuth 2.0 client ID and client secret from that project.
3. Redirect URI registered on that client: `http://127.0.0.1:6871/connectors/oauth/callback`
   (the broker's preferred loopback; it falls back to an ephemeral port, so
   register the fixed one to avoid re-registration).
4. For Google Ads only: the 22-character developer token.

**Microsoft Entra (unlocks 8 Work IQ connectors plus Microsoft Ads)**

1. Tenant ID (GUID).
2. An Entra app registration, public client, and its Application (client) ID.
3. Redirect URI on that app: `http://127.0.0.1:6871/connectors/oauth/callback`.
   Microsoft's own docs use `http://localhost:8080/callback`, so confirm which
   loopback form they accept.
4. The `WorkIQ-*` API permissions consented for the servers we want (Mail,
   Calendar, Teams, SharePoint, OneDrive, Word).
5. Confirmation of a Microsoft 365 Copilot license, which is a hard prerequisite.

**Salesforce**

1. My Domain URL (`https://<your-domain>.my.salesforce.com`).
2. In Setup, search MCP Servers, open Salesforce Servers, Activate the servers we
   want, then copy each **Server URL** and **API name**.
3. An External Client App, and its OAuth client ID and secret.
4. Confirmation the org is Enterprise Edition or above.

**PayPal**

1. Client ID and secret from the PayPal Developer Dashboard.
2. Whether we target live or sandbox first.

**Atlassian / Bitbucket**

1. An API token from id.atlassian.com, Security, API tokens.
2. Org admin enabling Bitbucket tools.
3. Confirmation the Bitbucket workspace is linked to the Atlassian org.

**TikTok Ads**

1. A TikTok for Business developer app, and its App ID and App Secret.

**Simple choices, no credentials needed**

1. Datadog: which site, US1 or EU.
2. AWS: which region, `us-east-1` or `eu-central-1`. Also confirm whether AWS MCP
   authenticates with SigV4 rather than OAuth, which would be a fifth shape.
3. GitLab: gitlab.com or a self-hosted host.
4. Shopify: store domain, and whether the account is Plus (the native servers are
   enabled from Settings, Apps and sales channels, MCP).

---

## 5. Open questions

1. **AWS auth method.** Endpoints are confirmed but the auth scheme is not. If it
   is SigV4, that is a fifth setup shape and a separate signing path.
2. **Pinterest Ads endpoint.** Official but alpha and partner-gated. No public
   endpoint published.
3. **Meta Ads exact URL.** `mcp.facebook.com/ads` is reported without a scheme or
   trailing path. Confirm against Meta's own docs before shipping.
4. **TikTok Ads endpoint.** Docs exist at
   business-api.tiktok.com/portal/docs/tiktok-ads-mcp-server/v1.3 but the endpoint
   string was not captured.
5. **Asana transport.** We ship the documented SSE endpoint. Given Atlassian
   retired its SSE endpoint, check whether Asana now offers `/mcp`.
6. **GitLab auth.** Endpoint confirmed; PAT versus OAuth not confirmed.
7. **Square and Vercel client gating.** Both restrict to reviewed clients. Find
   out whether Otto can be registered, or whether these will always fail for us.

---

## 6. Build sequence

1. ~~**Land section 1.**~~ **Done.** Eleven added (Slack, HubSpot, monday.com,
   Box, Dropbox, ClickUp, Trello, Airtable, Ahrefs, Netlify, Square), bringing the
   catalog to 29 selectable connectors. The picker gained search, an
   audience filter, and in-place expansion, because a flat list stops being
   browsable somewhere around twenty entries.
2. **Shape A** (own client ID and secret). Unlocks all of Google Workspace, the
   largest single win in the ledger.
3. **Shape B** (templated URLs). Unlocks Microsoft 365, GitLab, Shopify, Datadog,
   AWS, Salesforce.
4. **Shape C** (client credentials) for PayPal, and **shape D** (static token) for
   Bitbucket. Both small.
5. Re-check the section 3 list on a schedule. Half of it was wrong within a
   single day of research, and these vendors are shipping fast.

---

## 7. Otto-native connectors: we write the MCP server

Section 3 says "no official server exists". That is a statement about what a
vendor chose to ship, not about what is possible. Every service on that list has
a documented REST API. **When a vendor has not shipped an MCP server and we need
the integration, we write one.**

This is the fork's mission applied to connectors instead of providers: stop being
blocked on someone else's roadmap.

### The mechanism

The MCP SDK ships `InMemoryTransport.createLinkedPair()`. The daemon hosts the
server **in its own process** and connects a client to it over memory. No
subprocess, no port, no network hop.

Downstream, nothing changes. `OpenAICompatMcpManager` sees an ordinary MCP
client, so tool namespacing, per-tool disable switches, permission gating, and
the add-time verification gate all keep working untouched. We write the API
wrapper and inherit the entire connector subsystem for free.

### The protocol wrinkle

`McpServerConfigSchema` is a `z.discriminatedUnion` on `type`. Adding an `"otto"`
branch would make an old client fail to parse a new daemon's whole config, which
breaks the backward-compatibility contract. The safe shape is an **optional
`builtin` field on `ConnectorConfig`**, carried alongside a `server` value that
still parses on old clients. New daemons read `builtin` and route in-process.
Tag it `COMPAT(connectorBuiltin)`.

### The cost, stated plainly

An Otto-native connector is code we own forever: API drift, pagination, rate
limits, token refresh, token economy, tests. Adding a URL to the catalog is free.
This is not. Two or three of these is a healthy capability. Twenty is a second
product. Add them because we need them, never because we can.

### API research for the candidates

Everything below was gathered for implementation, not for triage.

#### Google Search Console (first target)

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Auth             | OAuth 2.0, user's own client ID and secret                                                |
| Scope            | `https://www.googleapis.com/auth/webmasters.readonly`, or `webmasters` to submit sitemaps |
| Search analytics | `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`     |
| Sites            | `GET https://www.googleapis.com/webmasters/v3/sites`                                      |
| URL inspection   | `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`                |
| Docs             | developers.google.com/webmaster-tools/v1/                                                 |

Query body: `startDate` and `endDate` (required, `YYYY-MM-DD`), `dimensions[]`,
`type` (web, image, video, news, googleNews, discover), `dimensionFilterGroups[]`,
`aggregationType`, `rowLimit` (1 to 25,000, default 1,000), `startRow`,
`dataState`.

Dimensions: `query`, `page`, `country`, `device`, `date`, `hour`,
`searchAppearance`. Metrics per row: `clicks`, `impressions`, `ctr`, `position`.

**Token-economy constraint, and it is the main design risk.** A single query can
return 25,000 rows. Piping that at a model is precisely what
[docs/token-economy.md](../../docs/token-economy.md) exists to prevent. The tool
must default `rowLimit` low (25 or so), require an explicit date range, and
return a compact aggregate unless raw rows are asked for. Build this in from the
first commit; it is not a later optimization.

Note the legacy naming: the scope and v3 endpoints still say "webmasters"
because Search Console used to be Webmaster Tools.

#### Google Business Profile

|                      |                                                           |
| -------------------- | --------------------------------------------------------- |
| Auth                 | OAuth 2.0, own client ID and secret                       |
| Scope                | `https://www.googleapis.com/auth/business.manage`         |
| Account management   | `https://mybusinessaccountmanagement.googleapis.com/v1`   |
| Business information | `https://mybusinessbusinessinformation.googleapis.com/v1` |
| Performance          | `https://businessprofileperformance.googleapis.com/v1`    |
| Docs                 | developers.google.com/my-business/                        |

Covers locations, reviews and review replies, local posts, and performance
insights. Split across three base URLs, so one connector fans out over several
hosts. **Gotcha:** Google gates API access behind an application, and requires a
verified profile active for 60 or more days.

#### Zendesk

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| Auth           | OAuth 2.0, or an API token                                 |
| Base URL       | `https://{subdomain}.zendesk.com/api/v2`                   |
| Token endpoint | `https://{subdomain}.zendesk.com/api/v2/oauth/tokens.json` |
| Docs           | developer.zendesk.com                                      |

**Per-tenant base URL**, so this needs a subdomain field. Scopes are
resource-grained: `tickets`, `users`, `organizations`, `macros`, `triggers`,
`automations`, `webhooks`, `requests`, `satisfaction_ratings`, `hc`,
`auditlogs` (read only), plus `read`, `write`, `impersonate`, `unrestricted`.
Scope format differs by endpoint: the OAuth Tokens API takes an array, the
grant-type token endpoint takes a space-separated string. Search is one endpoint
(List Search Results) across tickets, users, organizations and groups.

#### Todoist

|          |                                                                 |
| -------- | --------------------------------------------------------------- |
| Auth     | Bearer token: personal API token, or OAuth 2.0                  |
| Base URL | `https://api.todoist.com/rest/v2`                               |
| Scopes   | `data:read`, `data:read_write`, `data:delete`, `project:delete` |
| Docs     | developer.todoist.com/rest/v2/                                  |

Tasks, projects, sections, labels, comments, filters. Tokens do not expire unless
revoked via `POST /oauth/revoke_token`. **The cheapest connector on this list**:
a personal token needs no OAuth flow at all, so it is the right one to prove the
`builtin` plumbing on before tackling GSC's OAuth.

#### CircleCI

|          |                                                                        |
| -------- | ---------------------------------------------------------------------- |
| Auth     | Personal API token in a `Circle-Token` header (or Basic auth username) |
| Base URL | `https://circleci.com/api/v2`                                          |
| Docs     | circleci.com/docs/api/v2/                                              |

Categories: Pipeline, Workflow, Job, Project, Insights, Schedule, Context,
Webhook, Usage, User, OIDC, Policy. **Project tokens do not work on v2**, only
personal API tokens. No OAuth, so this is a pure static-token connector.

#### LinkedIn Ads

|          |                                                           |
| -------- | --------------------------------------------------------- |
| Auth     | OAuth 2.0 authorization code                              |
| Base URL | `https://api.linkedin.com/v2` (REST paths under `/rest/`) |
| Scopes   | `r_ads`, `rw_ads`, `r_ads_reporting`                      |
| Docs     | learn.microsoft.com/linkedin/marketing/                   |

`GET /rest/adAccounts?q=search` finds accounts. `adAnalytics` serves impressions,
clicks, spend and conversions with three finders: Analytics (group by one
element), Statistics (group by up to three), AttributedRevenueMetrics.

#### Reddit Ads

|          |                                                                |
| -------- | -------------------------------------------------------------- |
| Auth     | OAuth 2.0, scope `ads:manage`                                  |
| Base URL | `/api/v3/accounts/{account_id}/...`                            |
| Docs     | Reddit developer portal, requires an authenticated Ads account |

Access tokens expire after one hour, so refresh handling is mandatory rather than
optional. **Two real gotchas:** campaign-management endpoints fail even with
correct scopes until the account is approved, and rate limits are undocumented,
so backoff with jitter is required.

#### Pinterest

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| Auth           | OAuth 2.0; token exchange uses HTTP Basic with `app_id:app_secret`             |
| Base URL       | `https://api.pinterest.com/v5`                                                 |
| Token endpoint | `https://api.pinterest.com/oauth/token`                                        |
| Scopes         | `user_accounts:read`, `pins:read`, `pins:write`, `boards:read`, and ads scopes |
| Docs           | developers.pinterest.com/docs/api/v5/                                          |

Covers campaigns, ad groups, ads, creatives, reporting and catalogs. Worth doing
even though Pinterest has an official MCP server, because that server is a
partner-gated alpha we cannot reach.

#### StackAdapt

|           |                                        |
| --------- | -------------------------------------- |
| Auth      | API key in an `X-AUTHORIZATION` header |
| Interface | **GraphQL**, not REST                  |
| Docs      | docs.stackadapt.com                    |

Campaigns, creatives, audiences, pixels, conversion attribution, reporting. The
REST API's write operations are deprecated in favour of GraphQL, and **the
GraphQL API needs its own key**: an old REST key will not work. Being GraphQL,
this one does not fit a generic REST wrapper and needs hand-written queries.

### Suggested order

1. **Todoist.** Static token, small surface. Proves the `builtin` plumbing end to
   end with almost no auth work.
2. **Google Search Console.** The one actually asked for. Reuses the Google
   client ID and secret already being gathered for Workspace, so it costs one
   extra scope. Carries the token-economy design work.
3. **CircleCI**, then **Zendesk**. Static token and per-tenant OAuth respectively,
   which together exercise the last two auth shapes.
4. Ads platforms last. They are the most gated (Reddit needs account approval,
   LinkedIn needs a reviewed app) and the least likely to work first try.

---

## 8. Guided setup: everything configures from the Connectors UI

**The rule: no connector may require editing a config file, running a terminal
command, or leaving Otto except to click through a vendor's own consent screen.**
If a value is needed, the UI asks for it, tells the user what it is, and links
straight to the page that issues it.

This one concept replaces shapes A through D from section 2 rather than adding a
fifth. A connector declares an ordered list of fields; the UI renders them; the
daemon substitutes them into the endpoint and the auth flow.

```
SetupField =
  | { kind: "text";   key; label; help?; placeholder?; issueUrl? }
  | { kind: "secret"; key; label; help?; issueUrl? }
  | { kind: "choice"; key; label; options: { value; label }[]; help? }
```

and the connector's auth becomes one of:

| Auth kind                  | Who needs it                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `oauth-dcr`                | the 25 already shipped. Nothing to ask                                                                   |
| `oauth-client`             | Google Workspace, GSC, Business Profile, LinkedIn, Reddit, Pinterest, Zendesk, Microsoft 365, Salesforce |
| `oauth-client-credentials` | PayPal                                                                                                   |
| `header-token`             | CircleCI (`Circle-Token`), StackAdapt (`X-AUTHORIZATION`), Bitbucket                                     |
| `none`                     | DeepWiki, Semgrep, local servers                                                                         |

The endpoint becomes a template over the same field values, which is what
section 2's shape B needed: `https://{host}/api/v4/mcp` for GitLab,
`https://{subdomain}.zendesk.com/api/v2` for Zendesk,
`https://aws-mcp.{region}.api.aws/mcp` for AWS.

`issueUrl` is the part that makes this feel finished rather than like a form. A
field asking for a Google client secret links to the Google Cloud credentials
page. A field asking for a CircleCI token links to the personal API tokens page.
The existing rule that a `token` entry must carry `credential.issueUrl`
generalizes to every field.

The browser half is already built: the daemon's OAuth broker opens the vendor's
consent screen, catches the redirect on its loopback listener, and stores the
tokens. Guided setup only supplies the values the flow cannot discover on its
own.

## Timeline

- time: "2026-08-08T06:17:20.615Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:20.615Z"
  kind: "evidence"
  summary: "Migrated from `projects/connectors/connectors.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: **The verified vendor ledger.** Every connector considered, what was found, and what is still needed. Built: the daemon OAuth broker (DCR + PKCE + loopback listener + silent refresh), the add-time connect-and-enumerate gate, and connector-secret redaction (`connectors` is an array, so `SECRET_WIRE_PATHS` could never reach it and every pasted token was echoed to clients). The catalog carries **29 cited entries, 25 of them one-click sign-in**, with search, an audience filter and in-place expansion in the picker. **The correction this project records:** the first catalog shipped ~70 entries whose command was the literal `npx -y <slug-mcp-server>`, and the fix overshot, cutting vendors that do have official servers because one broad sweep missed them. Per-vendor research recovered 12 drop-in endpoints (Slack, HubSpot, monday.com, Box, Airtable, Dropbox, ClickUp, Trello, Ahrefs, Netlify, Square, Meta Ads) and found four setup shapes the current `ConnectorSetup` cannot express: **own client ID/secret** (all of Google Workspace, eight connectors), **templated URL** (Microsoft 365 tenant, GitLab host, Shopify store, Datadog site, AWS region, Salesforce org), **client credentials** (PayPal), **static token** (Bitbucket). **Section 7 opens a second front: Otto-native connectors**, where a service we need has no official MCP server and we write one. The daemon hosts it in-process over the SDK's `InMemoryTransport`, so tool namespacing, per-tool disable, permission gating and the verification gate keep working untouched; marked by an optional `builtin` field, never a new `McpServerConfigSchema` branch (that union is discriminated on `type`, so a new branch breaks old-client parsing of the whole config). Full implementation-grade API research gathered for **Google Search Console** (first target; its `searchAnalytics.query` returns up to 25,000 rows, making token economy a day-one constraint), Google Business Profile, Zendesk, Todoist, CircleCI, LinkedIn Ads, Reddit Ads, Pinterest and StackAdapt. **Section 8 is the governing UI rule:** no connector may require a config file or a terminal, so every setup value is an ordered field with a label and an `issueUrl` deep-linking the page that issues it, and the daemon drives the browser consent flow. The archived Postgres/MySQL/**SQLite** reference servers must not ship (SQLite has an unpatched SQL injection flaw). Durable rules in [docs/connectors.md](../docs/connectors.md)"
- time: "2026-08-08T06:19:42.485Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
