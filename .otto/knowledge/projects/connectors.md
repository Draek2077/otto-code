---
id: "connectors"
kind: "project"
title: "Connectors"
status: "confirmed"
tags: ["project-charter","legacy-projects-migration"]
delivery_status: "partial"
progress_completed: 0
progress_total: 5
progress_unit: "0.9 delivery slices"
created_at: "2026-08-08T06:17:20.615Z"
updated_at: "2026-08-27T02:08:00.464Z"
---
# Connectors

<!-- compiled_truth -->

# Connectors — 0.9 delivery charter

## Outcome

A Connector is a host-installed, agent-facing MCP capability, not an Otto-controlled Forge or Kanban integration. Every catalog row is real: it has guided in-app setup, daemon-owned credentials, add-time connect-and-enumerate verification, a durable actual-tool record, per-tool enablement, operation-to-scope evidence, honest provider routing, and repeatable automated and vendor or sandbox proof.

Forge and Kanban may reuse daemon authorization infrastructure but never inherit Connector credentials, configuration, workspace truth, board truth, or authority by default.

## Verified baseline — 2026-08-26

- The software catalog currently contains **28** entries: Notion, Atlassian, Box, Dropbox, Slack, Linear, monday.com, ClickUp, Trello, Asana, Canva, Figma, Webflow, Intercom, HubSpot, Stripe, Square, Airtable, Ahrefs, GitHub, Sentry, Supabase, Cloudflare, Netlify, Vercel, DeepWiki, Local files, and Persistent memory. The historic 29-row count in older records and the master charter is not supported by `connectors-catalog.ts`.
- Catalog entries carry a source URL and verification date. The current dates are `2026-08-03`, which are stale under [docs/connectors.md](../docs/connectors.md)'s six-month re-verification rule.
- All current rows are expressible only as fixed endpoint DCR OAuth, unauthenticated HTTP, or unauthenticated stdio. `ConnectorSetup` cannot represent ordered user fields, own OAuth client credentials, URL substitution, OAuth client-credentials, static HTTP-token authentication, or secure official local-server configuration.
- Settings has catalog search/filtering, add-time live `listTools` verification, installed-connector on/off and per-tool switches. Enumeration is transient: the daemon does not persist a verification timestamp, tool snapshot, scope evidence, or outcome.
- The daemon stores OAuth state separately from client-controlled config, uses loopback PKCE/DCR authorization and silent refresh, and redacts connector transport secret values plus OAuth tokens before emitting config to a client. Existing protocol has `connectors.list_tools.*` and OAuth authorize/disconnect/status messages gated by `features.connectors` and `features.connectorOauth`.
- Global connector and disabled-tool filtering is enforced in the OpenAI-compatible MCP manager. Provider registry passes connectors to the OpenAI-compatible family only. Other adapters can support user-supplied MCP server configuration but do not receive the Connector registry or its daemon-owned OAuth attachment. Therefore provider-neutral Connector routing is not yet implemented or proven.
- Automated coverage currently tests catalog citations/basic setup properties, OAuth state helpers, secret redaction, and OpenAI-compatible MCP behavior. No test proves every catalog row's setup contract, persisted enumeration state, scope map, provider routing matrix, connector recovery, or T1/T2/T3 release journey. No vendor-live proof was found in the repository.

## Release ledger

The catalog is the roster, and a daemon-owned ledger is the release evidence. It must contain exactly one entry per current catalog id and become the only place a row is declared release-ready. New research candidates remain outside the roster until deliberately added.

The initial roster is grouped by current setup shape:

| Shape | Catalog IDs |
| --- | --- |
| Fixed endpoint + DCR OAuth | notion, atlassian, box, dropbox, slack, linear, monday, clickup, trello, asana, canva, figma, webflow, intercom, hubspot, stripe, square, airtable, ahrefs, github, sentry, supabase, cloudflare, netlify, vercel |
| No credential HTTP | deepwiki |
| Official local stdio, no credential | filesystem, memory |

Each ledger row must record:

1. vendor documentation URL, re-verification date, release-roster status, transport, endpoint or approved local-server identity, and vendor limitations;
2. setup/auth shape, ordered nonsecret and secret setup fields with issue URLs, requested scope inventory, approved portal scope inventory, and ownership boundary;
3. latest live `initialize` and `tools/list` result, normalized tool names/descriptions, tool fingerprint, verification date, enabled subset, disabled subset, and a redacted failure/recovery verdict;
4. an exact operation-to-scope map for every Otto-owned API operation. Remote vendor-owned MCP tools may state **vendor-declared / unavailable to Otto** rather than invent a scope mapping;
5. provider routing evidence: each installed provider is classified as compatible and routed, compatible but blocked by a documented security/runtime boundary, or incapable. A provider without MCP capability must state that limitation and receive no connector;
6. linked deterministic setup/transport/redaction/routing tests and the appropriate live or vendor-sandbox proof. Credential- or vendor-gated rows record the actual externally-gated verdict, not success by inference.

## End-to-end delivery inventory

### UI and user journey

- Keep Settings as the installed-host ledger and the add sheet as catalog browsing. A catalog row must render its guided ordered setup fields, help, issue links, scope disclosure, provider availability, and vendor limitations without exposing MCP transport as user homework.
- Add and reconnect follow one explicit state machine: draft → input validation → daemon-owned save/authorization → connect/enumerate → verified or failed → recover/retry/disconnect/remove. A row cannot appear installed as verified merely because configuration was saved.
- Installed rows show last verification, actual tools, individual enablement, provider routing verdict, granted/account status where available, and actionable remediation. Switching a tool must affect the advertised agent surface, not only the Settings UI.
- Capability gates are centralized. An old host shows its upgrade boundary; it never receives new Connector RPCs or a silent compatibility fallback.

### Data, secrets, and storage

- The daemon owns authorization tokens, OAuth client credentials, client-credentials secrets, static tokens, verification state, tool snapshots, and account/consent metadata. Clients receive only masked presence and safe labels.
- Setup fields distinguish text, choice, and secret. Field values must have explicit persistence ownership, template substitution rules, validation, issue URL, and redaction coverage. Secrets may never enter transcript, browser, logs, config projection, analytics, tool result, or error text.
- Verification evidence is append-only enough to audit the current verdict, while stale snapshots are invalidated by connection/config/tool fingerprint change. Config evolution remains additive and parses in both directions.

### Daemon, protocol, transport, and recovery

- One daemon service resolves setup fields, stores secrets, constructs a transport, authorizes or refreshes as required, performs add-time and explicit re-verification, normalizes tools, and records redacted evidence.
- Support fixed DCR OAuth, own OAuth client ID/secret, templated endpoint fields, client-credentials, static token/header, and explicitly approved official local servers. Do not add arbitrary command execution to catalog setup.
- OAuth replacement rejects stale callbacks without terminating a current attempt. Silent agent refresh never opens a browser. Expiry, revoked consent, denied consent, missing setup field, port collision, invalid redirect, 401/403, transport mismatch, enumeration failure, vendor client approval refusal, rate limit, and local process failure each provide a safe recoverable verdict.
- New protocol fields are optional and pure structural schemas; new RPCs use dotted `.request`/`.response` names; client use is feature-gated in one place with a dated `COMPAT(...)` cleanup tag. No new union branch may make old clients reject Connector configuration.

### Provider routing and authority

- The provider-neutral resolver is the only entry point from the host registry to agent launch. It filters globally disabled connectors and disabled tools before a provider can advertise a tool.
- A provider receives a Connector only when its runtime can honor the required MCP transport, daemon-owned authorization boundary, tool filtering, and permission posture. It must not receive a serialized OAuth secret as a shortcut.
- OpenAI-compatible routing remains the reference implementation. Every other capable provider requires an explicit adapter or a daemon-owned authenticated bridge with the same namespacing, permission, output-capping, redaction, cancellation, and lifecycle guarantees. Incapable providers show an explicit limitation.
- Forge and Kanban remain separately configured, host/project-owned product integrations. A same-vendor Connector is free-form, has separate auth and per-tool grants, and cannot alter their configured authority by default.

### Catalog truth, scopes, docs, migration, and proof

- Revalidate every roster row against vendor documentation before the release. Correct stale endpoints, OAuth methods, supported transports, tool lists, scope statements, and partner/client approval restrictions. Remove a row that cannot meet the catalog rule rather than fabricating a result.
- Retire the misleading old count and update the master charter only after the roster ledger establishes its current count.
- Document supported setup shapes, security boundary, provider routing limitation/compatibility matrix, re-verification lifecycle, failure remediation, and official local-server allowlist in [docs/connectors.md](../docs/connectors.md). Keep the documentation index current.
- Existing configurations must preserve their transport, enabled state, disabled tools, and daemon-owned auth. New fields are additive; never migrate a user credential into a broader authority domain.
- T1 covers every roster row's metadata/setup validation, construction, redaction, tool-filter enforcement, provider-routing decision, failure classification, and capability gate. T2 exercises a local authenticated/unauthed MCP fixture through add → enumerate → per-tool disable → agent availability → retry. T3 or controlled vendor sandbox proof records per-row success or externally-gated verdict. Add the core journey to [[e2e-qa-coverage]]'s release matrix.

## Dependencies and explicit non-goals

Dependencies: [[integration-authorization-is-daemon-owned-and-reusable]], provider MCP adapters and capability reporting, [docs/protocol-validation.md](../docs/protocol-validation.md), [docs/rpc-namespacing.md](../docs/rpc-namespacing.md), [docs/token-economy.md](../docs/token-economy.md), and [[e2e-qa-coverage]].

Out of scope for this charter: turning Forge or Kanban into MCP connectors; credential sharing by default; cataloging unofficial or guessed endpoints; unbounded tool output; shipping archived reference servers, especially the archived SQLite server; treating a vendor's client-approval, account-review, or missing official MCP server as an Otto success; and adding Otto-native wrappers merely to inflate catalog count. An Otto-native connector requires explicit selection and its own pagination, rate-limit, token-economy, scope, lifecycle, and live-proof plan.

## Delivery slices

1. **Truth and ledger foundation:** make catalog roster metadata and daemon-owned verification evidence explicit; repair the count/staleness mismatch; add deterministic row-contract coverage.
2. **Guided setup shapes:** implement typed setup fields and daemon-owned construction for own OAuth client, templated URLs, client credentials, static header token, and approved local servers, with secret-safe recovery.
3. **Provider-neutral routing:** build the capability matrix and authenticated provider adapter/bridge path; prove the selected capable providers receive exactly the enabled tools and incapable ones state why not.
4. **Roster completion:** revalidate and add the currently blocked official rows only after their setup shape works, recording each live or externally-gated verdict.
5. **Release proof:** finish every row's scope/operation evidence, T1/T2 coverage, T3 or sandbox result, docs, and E2E coverage-matrix entry.

## Acceptance

Every current catalog row can be configured through Otto, connected and enumerated at add time, inspected using a current actual tool list, controlled per tool, and routed only to providers that can honor its security and MCP requirements. Every row has fresh vendor evidence, scope/operation truth or an explicit vendor-owned limitation, automated proof, and a live/sandbox/external-gate outcome. Failures are visible, redacted, recoverable, and never silently treated as a working integration.

## Plan-completeness gate and documentation readiness

The question is not “does the Settings screen render?” It is **“can Otto truthfully explain what this Connector can do for this user, through this provider, and prove it?”** The plan is complete only when every current roster row can answer the following questions with a linked implementation and evidence record.

| Question Otto must answer | Completion evidence |
| --- | --- |
| What is this Connector, and is it genuinely in the release roster? | Exact catalog id, vendor citation, current re-verification date, transport and release verdict. The roster count is derived from the catalog, never copied from an old planning number. |
| What must the user supply, and where do they obtain it? | Guided setup field definitions, validation, help and issue URLs. A user never needs a config file, command line, or guessed header. |
| Who owns the credential, and can it escape? | Daemon-only storage/write path, outbound redaction and inbound sentinel preservation tests for every secret-bearing shape. |
| What can Otto really enumerate today? | A redacted successful or failed `initialize → tools/list` evidence record with timestamp, actual tool set and fingerprint. Catalog prose is not a substitute. |
| What tools are currently available to the agent? | Current enabled connector/tool state, filtered before provider advertising, plus proof that a disabled tool cannot be called. |
| Which provider can use it? | A provider/transport/auth routing verdict: routed, explicitly blocked by a documented security/runtime boundary, or incapable. “MCP capable” alone is insufficient if that adapter cannot honor daemon-owned auth and tool filtering. |
| What authority does it carry? | Vendor-approved scopes, requested scopes and Otto-owned operation-to-scope map. For a remote vendor-owned tool surface, record that the mapping is vendor-declared/unavailable rather than inventing precision. |
| How does a failure recover? | Tested and user-visible remediation for missing fields, denial, expiry/revocation, stale callback, transport failure, empty tool surface, vendor approval restriction, rate limit and local-server failure. |
| What has been proved? | Deterministic T1 coverage, local fixture T2 journey and live vendor/sandbox or explicitly externally-gated T3 verdict, all linked per row. |

### Per-row completion chain

Each catalog id must pass this chain in order. A failure stops the row at its real verdict; it is not converted to an implied success.

```
Roster truth → Guided setup → Daemon-owned authorization/storage
→ Initialize + tools/list → Per-tool enablement → Provider routing
→ Real tool invocation → Recovery → Automated proof → Live/sandbox verdict → End-user documentation
```

The release ledger records the evidence at every arrow. A row is **release-ready** only after it reaches the documentation stage or has an explicit, current externally-gated verdict. A row that is merely researched, renders in the picker, or has a hand-written endpoint is not release-ready.

### Module-level “is our plan complete?” review

Before changing delivery status to complete, conduct one adversarial review against the catalog, source, release charter and documentation. The reviewer must be able to answer **yes** to all of these:

- Does the ledger contain exactly every catalog id, with no phantom, duplicate, stale or uncited row?
- Is every setup/auth shape represented by a secure in-app path, including its field validation, storage, transport construction, failure and migration behavior?
- Does every secret-bearing path have redaction proof across config projection, echo-back patch, logs, errors and provider execution?
- Are actual tool snapshots durable, freshness-bounded, tool-filtered and visible to users, rather than inferred from catalog copy?
- Does every MCP-capable provider have an explicit Connector routing outcome, and does no provider receive authorization material it cannot safely honor?
- Are Forge and Kanban still authority-separated from same-vendor Connectors by default?
- Does every active Otto-owned operation have a scope map, while vendor-owned remote tool scopes are honestly labelled as unavailable to Otto?
- Is every failure class actionable and recoverable, with no failed add retained as a verified installation?
- Is T1/T2/T3 proof present at the required level for every row, with vendor policy/account gates reported rather than waived?
- Does [docs/connectors.md](../docs/connectors.md) describe exactly the shipped provider matrix, setup shapes, limitations, recovery and verification semantics, without implying unshipped capabilities?

A single unanswered question is either a planned delivery item, an explicit non-goal, or a blocker. It is never silently omitted from the completion claim.

### End-user documentation contract

Documentation must be generated from the same ledger, not from aspirational catalog copy. An installed Connector's documentation card needs: what it does; required setup; provider availability; account/authorization and last verification state; actual tools and enabled subset; access/scopes and vendor limitations; recovery actions; and proof/outcome status.

Until provider-neutral routing and durable per-row evidence exist, documentation may accurately describe the current **OpenAI-compatible / Otto Brain** Connector journey and the catalog's stated setup, but must explicitly say that broader capable-provider support and per-row live proof are still in delivery. It must not claim that every provider, every catalog row, or every vendor scope is fully supported.

## Executable assertion audit and feature-acceptance proof

This charter uses two test gates. The first turns every statement about the current implementation into reproducible evidence. The second proves the completed user-facing feature. Neither code inspection, a rendered Settings screen, nor an isolated vendor success substitutes for the other.

### Gate A — current-state assertion audit

Maintain a claim matrix whose rows are the assertions in **Verified baseline**. Each row is classified **Proven**, **Implemented but unproven**, **Provider/host limited**, **Planned**, or **Out of scope**, and links the exact test or controlled observation. The initial test work must cover:

| Assertion | Required proof |
| --- | --- |
| Catalog truth | Exact roster ids, uniqueness, current citation/date validity, no placeholders, and a roster count derived from source rather than planning prose. |
| Current setup boundary | Type/data tests prove the catalog exposes only supported shapes; UI tests prove unsupported rows cannot masquerade as guided setup. |
| Secret boundary | Config projection, redacted echo-back, logs/errors and tool output never reveal OAuth, header, environment, client-credential or setup-field secrets. |
| Add-time gate | A failed authorization, unreachable transport, failed `tools/list`, or zero tool surface leaves no verified installed Connector; rollback failure is explicit. |
| Tool enforcement | Enumerated disabled tools are visible for management but absent from the agent-advertised/callable surface. |
| Provider boundary | OpenAI-compatible/Otto Brain routing is proved; every other provider has an explicit non-routing or capability verdict until an adapter/bridge exists. |
| Authority boundary | Same-vendor Connector configuration/credential cannot alter Forge or Kanban configuration or authority by default. |

### Gate B — end-user feature acceptance

After implementation, every roster entry is tested at three complementary tiers.

#### T1: deterministic PR coverage

Use local fixtures and pure tests, never environment-auth checks, to cover every roster id and every supported setup shape. Required cases include schema backward compatibility; guided field validation and endpoint construction; OAuth DCR, supplied client credentials, templated URL, client-credentials, static header token and approved local-server construction; redaction; expiry/reconnect/stale callback behavior; HTTP/SSE/stdio initialization; tool snapshot/freshness/filtering; provider routing; Forge/Kanban separation; failure classification; and documentation/ledger traceability.

#### T2: controlled local daemon journey

Run a real daemon and app/client against controlled OAuth and MCP fixtures. The fixture must execute:

```
Add connector → guided setup/authorization → initialize + tools/list
→ disable one tool → launch compatible provider → enabled tool succeeds
→ disabled tool is unavailable → expire/revoke or break transport
→ actionable recovery → re-verification
```

This is the primary integration proof because it crosses UI, protocol, daemon storage, redaction, transport, routing and agent execution without depending on a vendor’s availability. The fixture uses known local credentials and records no real secret.

#### T3: vendor or sandbox outcome

For each release roster row, use a controlled vendor account/sandbox where policy permits: connect, enumerate actual tools, invoke one safe read-only or sandbox operation, and retain a dated redacted verdict. A vendor-required account review, client approval or unavailable sandbox passes only as **externally gated** with the actual vendor response captured. It never becomes a green success by inference. Do not make routine automated tests conditional on a developer’s vendor credentials.

### Documentation and release evidence gate

The documentation is tested as a projection of the ledger. Every published Connector card must name its setup requirement, provider availability, latest verification/tool state, enabled subset, authority/scopes or vendor-owned limitation, recovery action and outcome status. A documentation contract test fails if a row claims provider-neutral availability, an unimplemented setup shape, a scope Otto cannot map, or a live success that lacks evidence.

The feature is complete only when every roster id has passing T1 coverage, a passing T2 journey, and a current T3 success or explicit externally-gated verdict. Any missing row, stale claim, unclassified provider, unredacted path, missing recovery proof or unsupported documentation statement keeps delivery status **partial**.

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
- time: "2026-08-27T01:47:17.129Z"
  kind: "decision"
  summary: "User requested a canonical 0.9 end-to-end delivery inventory after source-based review; replace the migrated research ledger with a current, evidence-backed charter while retaining its history in the timeline."
  source: "User direction, docs/connectors.md, packages/app/src/screens/settings/connectors-catalog.ts, connectors-add-sheet.tsx, connectors-section.tsx, connectors-config"
- time: "2026-08-27T01:49:53.971Z"
  kind: "note"
  summary: "Completed and verified only the add-time admission-gate sub-slice: failed authorization/enumeration now rolls back the temporary connector and zero-tool servers are rejected. This strengthens slice 1 but does not complete the roster-ledger foundation, so no delivery slice is marked complete."
  affects: ["connectors"]
- time: "2026-08-27T01:50:04.895Z"
  kind: "evidence"
  summary: "Verified 0.9 admission-gate sub-slice: catalog installation persists a temporary connector only to let the daemon-owned OAuth flow identify it, then removes that exact snapshot when OAuth or tools/list fails. A zero-tool result is rejected. Unit coverage proves success retention, verification-failure rollback, and honest rollback-failure reporting. `npx vitest run packages/app/src/screens/settings/connectors-config.test.ts packages/app/src/screens/settings/connectors-catalog.test.ts --bail=1` passed (3 files, 187 tests); targeted format and lint passed. App typecheck still fails in pre-existing Project Knowledge/refinement sources outside the Connector files; no Connector errors remain."
  source: "packages/app/src/screens/settings/connectors-add-sheet.tsx; packages/app/src/screens/settings/connectors-config.ts; packages/app/src/screens/settings/connectors"
  affects: ["packages-app-src-screens-settings-connectors-add-sheet-tsx","packages-app-src-screens-settings-connectors-config-ts"]
- time: "2026-08-27T02:00:40.704Z"
  kind: "decision"
  summary: "User requested an explicit way to judge whether the Connector plan is complete and whether end-user documentation reflects actual capability; add the evidence questions, per-row completion chain, adversarial review gate, and documentation contract."
  source: "User direction on 2026-08-26; verified baseline in docs/connectors.md and Connector catalog/daemon/provider sources recorded in this charter."
- time: "2026-08-27T02:08:00.464Z"
  kind: "decision"
  summary: "User requested the project charters capture how current assertions and final Connector completion will be tested; add an executable baseline audit plus T1, T2, T3, documentation and release-evidence gates."
  source: "User direction on 2026-08-26; docs/testing.md; docs/connectors.md; source-audit findings already recorded in this charter."
