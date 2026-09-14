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
updated_at: "2026-09-14T02:16:38.363Z"
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
- time: "2026-09-12T17:13:22.054Z"
  kind: "evidence"
  summary: "Google readiness recheck: the current CONNECTOR_CATALOG has 28 entries and none for Google Drive, Gmail, or Calendar. connectors-catalog.ts explicitly lists Google Workspace under setup shapes not built; ConnectorSetup and CatalogInstallPanel expose no guided own-client Google setup. Search of packages/, docs/, and public-docs/ found Google service mentions only in catalog exclusion comments and connectors documentation, with no Google connector implementation. connector-oauth.ts supplies generic MCP SDK discovery/DCR/PKCE, daemon-held tokens and refresh; this is infrastructure, not an implemented Google authorization journey. Provider registry and resolveEnabledConnectors usage still route the Connector registry through OpenAI-compatible agents including Otto Brain, without equivalent consumption in the other provider adapters. Targeted checks passed: connectors-catalog.test.ts 92 tests; connector-oauth.test.ts 11 tests. These are unit tests, not live Google proof. Verdict: Google Drive/Gmail/Calendar are not ready for Joanna through the built-in Add Connector journey in this checkout. No installed-app, Joanna-account, vendor consent or real Google tool invocation was tested. No product code changed. Existing charter already covers these gaps; this audit strengthens its evidence without changing delivery or review status."
  source: "Source audit of main c3f2b840d (0.9.8), 2026-09-12; user asks whether Joanna can use Drive, Gmail and Calendar."
- time: "2026-09-12T18:46:20.558Z"
  kind: "evidence"
  summary: "Following the readiness audit, implemented Google Drive, Gmail and Google Calendar using Google's documented hosted MCP endpoints. The catalog now has 31 cited entries. Guided own-client setup requests service-specific scopes through daemon-owned Google OAuth with fixed loopback redirect, PKCE, offline refresh and endpoint-bound credentials. Add-time enumeration remains the admission gate; installed Google cards support reconnect and disconnect. ConnectorToolCatalogService now exposes actual paginated vendor tool definitions through the shared native/agent-MCP catalog, with live connector/tool-disable enforcement, bounded client caching and daemon-held secrets. Native launch passes its working directory explicitly; MCP providers can resolve it during create/resume/import/reload before registration. This removes the former OpenAI-compatible-only connector injection. Provider limits remain: Otto tool injection must be enabled; Pi requires its MCP adapter; unbound and voice-only clients receive no connector authority. Google Calendar's requested scopes are read/availability only. Verified targeted checks: catalog 101 tests, generic OAuth 11, Google OAuth 5, shared connector catalog 2, MCP transport 7, secret projection/echo-back 8, native and early-MCP launch cases 3, compatibility-provider catalog case 1. Server, app, protocol and client typechecks plus targeted lint/format passed; app workspace dependency build completed. Otto browser snapshot and screenshot verified the Google catalog and expanded Gmail credential form with empty-input Connect disabled. Development daemon/app were observed listening on 6788/8081; installed daemon was not restarted. No live Google consent or tool invocation, Joanna account enrollment, packaged release, or per-provider vendor end-to-end proof occurred. Google Developer Preview eligibility, Cloud service/MCP APIs and OAuth registration are still prerequisites for the user's account test. The larger charter remains partial: durable per-row release evidence, other setup shapes and live provider/account coverage are unfinished."
  source: "Google connector implementation in checkout, 2026-09-12; docs/connectors.md; protocol/google-connectors.ts; connectors/connector-tool-catalog.ts and focused tes"
  affects: ["connectors"]
- time: "2026-09-12T19:01:10.672Z"
  kind: "evidence"
  summary: "User corrected the Google integration direction: Otto must expose its own tools backed by normal personal-account Google APIs; Google-hosted Workspace developer-preview MCP endpoints and user-supplied Cloud client credentials do not satisfy the requirement. Required Google operations: Drive list/read/write; Gmail list/read/create/reply/forward; Calendar list/read/create. Microsoft Outlook mail/calendar and OneDrive equivalents are desired through the same approach. Sign-in should use Otto publisher-owned registered OAuth applications and daemon-owned authorization, with end users selecting an account and consenting. Existing shared provider tool-catalog work may be retained, but the previous Google-hosted MCP implementation and its setup documentation are not proof of this corrected requirement and remain to be replaced. Activepieces community TypeScript actions were source- and package-inspected as a reuse candidate; detailed evidence is on reference-activepieces. This research did not implement the replacement, register OAuth apps, or prove a real Google/Microsoft sign-in or tool call. Joanna's requested personal-account journey is not yet verified ready."
  source: "User correction and source evaluation in this chat, 2026-09-12"
  affects: ["reference-activepieces"]
- time: "2026-09-12T20:23:09.370Z"
  kind: "evidence"
  summary: "Google connector implementation and live evidence, 2026-09-12: ordinary Desktop OAuth over the shared daemon IntegrationAuthorizationService and OS vault now connects Gmail, Drive and Calendar from the Otto Add connector UI without user client IDs/secrets or preview knobs. Browser verification reported 6 Gmail, 4 Drive and 4 Calendar tools; all three grants survived an isolated dev-host restart. Scope inventory was saved in the publisher Google Auth Platform Data Access page and is checked against operation/OAuth declarations by google-connector-scopes.test.ts. Live source-handler calls using the dev host grants verified Gmail list/create-draft/read; Drive list/create/read/update/read; Calendar list-calendars/list-events/create/read. Temporary draft and event were deleted; the temporary Drive file was moved to Trash. No email was sent. send/reply/forward remain live-unverified. Google REST tools have bounded pages/results, fixed vendor URLs, no write replay, and separate service files. ConnectorToolCatalogService feeds native and internal-MCP provider paths; google-connector-service.test.ts proves all 14 names/schemas and live disabled-tool rejection through both paths. No model-backed journey for every provider or packaged desktop release was run. Native Google authorization is separate from generic MCP auth, uses per-connection serialization/generation guards, and no account token is supplied to the app/provider launch config. Hosted MCP alternative is daemon-policy-selected, with real-read admission before exposing public tools/list: unauthenticated catalogs yielded 23 Gmail, 8 Drive, 9 Calendar tools; authenticated Gmail/Calendar returned explicit Developer Preview enrollment denial and Drive permission denial, while corresponding REST reads were HTTP 200. Hosted Gmail has no send operation in the observed catalog. Public rollout remains incomplete: OAuth app is External/Testing, Google verification/public publication and release-build publisher input distribution remain pending; callback requires a browser on the host computer. Microsoft connector implementation/registration was not completed. Documentation replaces the earlier hosted-only/manual-client setup description. Targeted tests, app/server typechecks, lint and server build passed; broad connector charter remains partial."
  source: "docs/connectors.md; packages/server/src/server/connectors; controlled development-host verification, 2026-09-12"
- time: "2026-09-13T05:41:45.032Z"
  kind: "evidence"
  summary: "Figma remote connector failure reproduced with the installed MCP SDK and the exact public client metadata from ConnectorOAuthProvider (client_name Otto, client_uri https://otto-code.me, loopback redirect, token_endpoint_auth_method none), without account credentials or persisted registration. Protected-resource discovery and authorization-server discovery each returned HTTP 200. POST https://api.figma.com/v1/oauth/mcp/register returned HTTP 403 with plaintext Forbidden; the SDK produced the exact Invalid OAuth error response / Unexpected token F error from the user's screenshot. The failure occurs during application registration before a user authorization redirect. Figma's official https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/ and remote-server-installation/ state that only clients listed in the Figma MCP Catalog can connect and direct new clients to a waitlist. This policy is consistent with the measured rejection of Otto; the 403 body itself gives no further reason. The current Otto Figma catalog row exposes ordinary OAuth Sign in with no client-approval limitation. No account login, tool enumeration, code change, or vendor approval was completed."
  source: "Figma live OAuth registration diagnostic and official access documentation, 2026-09-12"
- time: "2026-09-13T05:42:10.983Z"
  kind: "evidence"
  summary: "Investigated Google setup showing 'Update the host' on a matching desktop/daemon install. The installed 0.9.10 app.asar contains google-connector-authorization.js but no google-oauth-client.json. Desktop release workflow supplied neither publisher registration input nor a missing-registration gate, and the repository had no Google connector registration secret. Added OTTO_GOOGLE_OAUTH_CLIENT_JSON to repository Actions secrets using the Desktop registration from the earlier Google tests (no credential values recorded here). Prepared local changes wiring that secret to all four desktop build paths, requiring it for publishing, rejecting ambiguous or malformed inputs without echoing credentials, and removing stale build identity. Add/reconnect UI now describes unavailable Google sign-in instead of assuming an old host. Seven focused packaging tests, targeted lint, and app typecheck passed. These source changes are not yet committed or released; no installed-app restart, new installer, or end-to-end sign-in was performed. Local/npm release shells must retain publisher input through the server prepack clean rebuild, as documented in docs/release.md."
  source: "Installed Otto 0.9.10 app.asar inspection, repository Actions secret inventory, and local packaging regression verification, 2026-09-12"
- time: "2026-09-13T05:42:47.987Z"
  kind: "evidence"
  summary: "Slack sign-in investigation: the user reported \"Incompatible auth server: does not support dynamic client registration\". Slack explicitly excludes DCR in https://docs.slack.dev/ai/slack-mcp-server/ and requires a registered Slack app (internal or Marketplace-published; unlisted apps prohibited). A read-only fetch of https://mcp.slack.com/.well-known/oauth-authorization-server confirmed no registration_endpoint. Current connectors-catalog.ts routes slack to generic OAuth at https://mcp.slack.com/mcp; connector-oauth.ts supplies only stored client registration, and the installed MCP SDK throws this exact error when registration_endpoint is absent. This contradicts the charter and docs/connectors.md classification of Slack as fixed endpoint plus DCR. Registered app authorization support and Slack app eligibility remain prerequisites; no account authorization or tool call was attempted, and no runtime fix is claimed. Slack separately documents desktop public-client PKCE at https://docs.slack.dev/authentication/using-pkce/; do not assume bundling a confidential client secret is required or appropriate."
  source: "Slack vendor docs and public OAuth metadata verified 2026-09-12; current checkout source"
- time: "2026-09-13T05:58:54.755Z"
  kind: "evidence"
  summary: "User requested temporarily removing Figma from the connector list because it cannot connect. Removed the Figma entry from packages/app/src/screens/settings/connectors-catalog.ts, excluding it from both user and developer catalog browsing/search. Updated docs/connectors.md to exclude Figma from the setup table and require Otto client approval plus successful sign-in and tool enumeration before restoring the row. Figma's linked application form states new MCP client approvals are paused; it accepts public-client requests for future consideration. Catalog test file passed all 100 tests and targeted catalog lint passed. This is a source change, not proof of an installed-app update or successful Figma access; existing host connector configurations were not modified."
  source: "User decision and local verification, 2026-09-12"
- time: "2026-09-13T06:11:39.574Z"
  kind: "evidence"
  summary: "2026-09-13 Dropbox catalog correction: the user supplied a screenshot rejecting dynamic registration and allowing only pre-registered MCP trusted partners. Dropbox's official Supported MCP clients section restricts DCR to a trusted client list that does not include Otto; its Other MCP clients section documents separate Dropbox app registration. Source inspection of connector-oauth.ts confirms Otto identifies itself as Otto and relies on saved registration or SDK dynamic registration; the catalog incorrectly advertised Dropbox through that generic OAuth path. Removed only the Dropbox catalog entry, adjusted existing catalog test expectations, and corrected docs/connectors.md. Restore only after a supported Otto registration path plus successful sign-in and tool enumeration. Verification: connectors-catalog.test.ts 97 tests passed, app typecheck passed, targeted lint passed. This proves the local catalog correction, not Dropbox account authorization or installed-app deployment. Existing saved connector configuration was not modified."
  source: "User-reported Dropbox sign-in screenshot; https://help.dropbox.com/integrations/connect-dropbox-mcp-server (checked 2026-09-13)"
- time: "2026-09-13T06:19:12.749Z"
  kind: "evidence"
  summary: "Slack DCR mismatch resolved in source. The user registered the Otto Slack app and authorized completing its settings. Verified portal configuration: Slack MCP enabled, PKCE enabled, fixed callback http://127.0.0.1:6871/connectors/oauth/callback, 30 user scopes from Slack's MCP bundle, app installed in Otto: Code. Agent experience is off following the user's correction. connector-oauth-registration.ts now owns the public client identity and explicit approved/requested scope bundle; connector-oauth.ts selects it by exact HTTP endpoint, pins authorization/token endpoints, binds persisted credentials to app/endpoint/callback, and fails clearly on fixed-port collisions instead of changing ports. No confidential client secret is packaged. A fresh empty in-memory store using the changed broker completed live Slack PKCE sign-in and initialized the official MCP server, listing 27 tools. No messages or other Slack content were written; temporary tokens were held only in the probe process. Seven targeted tests pass for registered and DCR flows, public-client PKCE exchange and refresh-token rotation, endpoint mismatch, foreign credentials, stale callback isolation, and registered-port collision. npm run lint and npm run typecheck (all workspaces) passed. docs/connectors.md corrects Slack's authentication classification and documents registration and release limits. Main installed daemon was not restarted; normal installed-app Connect needs a build containing this source fix. Public Marketplace distribution and installed UI end-to-end use are not proven."
  source: "2026-09-13 Slack app settings, live registered-client OAuth probe, targeted regression tests, full workspace typecheck"
- time: "2026-09-13T06:28:13.732Z"
  kind: "evidence"
  summary: "Correction to this chat's prior Dropbox delisting evidence: the observed rejection proves only that Otto's automatic registration attempt failed. The same official MCP guide explicitly provides Connecting from other MCP clients and Dropbox app setup instructions. Dropbox's OAuth guide says the publisher registers an app once and end users authorize it; users should not register their own apps. The user challenged treating failed DCR as grounds to delist and stop. Restored the Dropbox catalog entry and original catalog test expectations, and corrected docs/connectors.md to distinguish the documented registered-app route from current unverified Dropbox authorization. Current source now has a publisher-owned registered-client seam for Slack in connector-oauth-registration.ts, but no Dropbox registration there. Dropbox app registration, vendor-specific OAuth integration, refresh, and live MCP tool access remain to be implemented/verified; no claim that Dropbox is unusable or that access has succeeded is supported. Restored catalog: 100 tests passed and targeted lint passed. This correction supersedes the earlier delisting recommendation; it does not erase the original observed DCR rejection."
  source: "User correction in this chat; https://help.dropbox.com/integrations/connect-dropbox-mcp-server; https://developers.dropbox.com/oauth-guide (rechecked 2026-09-13"
- time: "2026-09-13T06:28:54.396Z"
  kind: "evidence"
  summary: "Slack build inclusion verified after the user requested preventing a repeat of missing Google OAuth build assets. Ran npm run build:server-deps and npm run build --workspace=@otto-code/server successfully. Slack's public registration/scopes compile into dist/server/server/connectors/connector-oauth-registration.js; its consuming connector-oauth.js is packaged alongside it under the server package's existing dist/server inclusion. No Slack JSON asset, environment variable, client secret, or copy script is needed. Produced an actual npm tarball with npm pack --workspace=@otto-code/server --ignore-scripts after the manual daemon build, extracted both modules, compared them byte-for-byte with generated output, and imported the packed registration to verify the public client identity and 30 scopes. Desktop after-pack.js now checks both modules inside the actual app.asar against fresh compiled output and rejects omissions, empty files, or stale bytes before signing/publishing. Seven tests use real fixture ASAR archives across Windows/macOS/Linux directory layouts and cover missing and stale files. Lint and full workspace typecheck passed. This is daemon build + npm tarball proof and an exercised desktop packaging guard, not a newly built desktop installer or released artifact."
  source: "2026-09-13 Slack packaging verification"
- time: "2026-09-13T06:45:41.610Z"
  kind: "evidence"
  summary: "The reported Vercel callback showed the MCP SDK's missing-client error. Source tracing and deterministic tests verify that auth() can mask an invalid_client or unauthorized_client token rejection by deleting registration and retrying the same code. The broker now exchanges a callback code once with the original discovery state, reports the original OAuth error with credentials redacted, and leaves fresh registration to the next Connect attempt. Targeted OAuth tests passed (15), targeted lint and full workspace typecheck passed. Live diagnostic DCR accepted an Otto public client; a deliberately invalid, non-user code returned invalid_grant from both Vercel token endpoint URLs. This proves registration/client recognition only, not successful user consent, token issuance or MCP access. The underlying rejection of the user's approved attempt remains unverified; no installed daemon was restarted or updated."
  source: "Vercel callback investigation, 2026-09-13; connector-oauth.ts, connector-oauth.test.ts, docs/connectors.md"
- time: "2026-09-13T06:46:36.351Z"
  kind: "evidence"
  summary: "Verified Dropbox registered-app access on 2026-09-13: configured Otto Code public app key ir4e1ixjf542mq8 with the eight scopes published by https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp, public clients/PKCE allowed, and callback http://127.0.0.1:6872/connectors/oauth/callback (6871 was occupied by the installed app; its listener was not stopped). The user completed consent through Otto browser. A temporary source-based broker with an in-memory store obtained an access token and refresh token, enumerated 25 MCP tools via Otto listConnectorTools, refreshed successfully, and called who_am_i successfully. Tokens were never printed or persisted by that check; its helper was removed. Dropbox registration is implemented in the existing publisher-registration resolver with token_access_type=offline; no app secret is shipped. App remains Development/owner-only; public distribution is not verified. Packaging audit: Slack and Dropbox identities compile into connector-oauth-registration.js and were confirmed in rebuilt server npm dry-run file listing. Google needs google-oauth-client.json; its CI secret name exists and all four desktop build paths pass it and require it when publishing. Extended desktop afterPack verification to compare Google auth module and configured JSON with actual app.asar, rejecting missing/stale/unexpected assets. Added server prepublishOnly requiring Google registration input even without the opt-in flag; directly verified that absent input fails the hook. Validation: 8 registered OAuth tests; 12 desktop archive tests; 7 Google copy/workflow tests; 100 catalog tests; server build; relevant typechecks and lint all passed. The local shell has no Google input configured and its current build omits that JSON. No full new desktop installer was built or published; installed Settings sign-in still needs the updated host code."
  source: "User-authorized Dropbox portal configuration and completed consent on 2026-09-13; connector-oauth-registration.ts; docs/connectors.md; docs/release.md; desktop "
- time: "2026-09-13T13:59:29.600Z"
  kind: "evidence"
  summary: "Box sign-in blocker verified on 2026-09-13. User screenshot reports 'Incompatible auth server: does not support dynamic client registration'. Both live discovery GETs returned HTTP 200: https://mcp.box.com/.well-known/oauth-protected-resource identifies https://api.box.com/ as authorization server; https://api.box.com/.well-known/oauth-authorization-server omits registration_endpoint, advertises S256 PKCE and only client_secret_basic/client_secret_post for token authentication. Current catalog sends Box through generic OAuth, while getConnectorOAuthRegistration covers only Slack and Dropbox public clients; the SDK throws the screenshot's exact error when registration_endpoint is absent. Box's official setup guide documents Admin Console integration credentials (client ID, client secret, redirect URI, scopes); its official remote-server repository also describes a Developer Console OAuth-app route. This corrects the historic Fixed URL + DCR classification for Box. Registration access and secure confidential-client integration remain unresolved; public-client support must not be inferred from S256 alone. Opened a dedicated Otto browser tab to Box Developer Console, which requires login. No credentials, account authorization, MCP enumeration, tool call, or installed-app fix is verified; no runtime/config/source changes made. Retain the vendor while investigating the supported registered-client route; DCR failure alone is not proof Box is unusable."
  source: "2026-09-13 Box sign-in investigation; https://developer.box.com/guides/box-mcp/setup; live Box OAuth discovery"
- time: "2026-09-13T14:07:00.062Z"
  kind: "evidence"
  summary: "Reproduced the user's post-consent create_form_submission schema rejection using mondaycom/mcp master packages/agent-toolkit/src/core/tools/platform-api-tools/workforms-tools/create-submission-tool/schema.ts and its Zod 3 JSON-schema conversion. The signature answer emits $ref #/properties/answers/items/properties/file/items; Otto's installed Zod fromJSONSchema throws Reference not found for that valid nested pointer. Added shared local-pointer relocation for connector verification and provider-neutral catalog construction, preserving reusable/recursive schemas and rejecting unresolved/external references. Source validation: 8 focused schema tests and 3 real local MCP catalog tests passed; the latter verify setup enumeration, native and internal-MCP exposure/invocation, rejected invalid arguments, pagination, reconnect, disable and redaction behavior. The complete published monday submission schema now converts and retains valid/invalid argument behavior after JSON-schema serialization. Server typecheck, targeted lint and formatting passed. No monday account tools were invoked and no installed daemon was restarted or updated; actual hosted catalog and installed Settings reconnection remain unverified."
  source: "monday.com schema investigation, 2026-09-13; connector-input-schema.ts; connector-input-schema.test.ts; connector-tool-catalog.test.ts; docs/connectors.md"
- time: "2026-09-13T16:27:31.810Z"
  kind: "evidence"
  summary: "User requires Box for all Otto users, exactly one reusable hosted authentication service for future confidential-client vendors, transparent credential handling, and additive Paseo-compatible daemon ownership across desktop/mobile/web. Local implementation is now present in packages/auth-service (Cloudflare Worker plus one Durable Object per grant), with Box as the first allowlisted adapter. The existing connector OAuth broker and provider-neutral tool catalog delegate to a daemon driver using IntegrationAuthorizationService and the OS vault. Publisher secrets are runtime service bindings; user tokens and host possession proof stay in the daemon vault; clients receive optional status/account/scopes only. The service temporarily stores codes/PKCE state, serializes one-use collection and refresh, persists refresh/proof hashes rather than user token sets, and reports unconfirmed revocation separately from local deletion. Five-minute sign-in expiry and 90-day sliding grant metadata expiry are application limits; cloud backup retention is separate. Added UI disclosure/capability gate, dedicated staging/production CI workflow disabled until explicit bootstrap, and indexed deployment/security runbook docs/connector-auth-service.md. Verified 17 hosted/protocol tests, 7 connector UI tests, and 18 existing OAuth/catalog regression tests; all-workspace typecheck, client/server builds and targeted lint passed. Bundled Worker passed Miniflare/workerd consent, callback, collection, replay rejection, refresh and revocation with synthetic vendor responses and blocked external networking. This caught Workers rejecting redirect:error; service now uses redirect:manual and rejects non-success token responses. Actual server/protocol npm archives contain byte-identical compiled hosted-auth modules and exclude the service/probe code. New owned connector/integration/service directories do not exist in the inspected local upstream/main baseline d1b705a0cd91617a5707fae25d80cb0be3057950; shared bootstrap/protocol seams still need future merge review. No deployment, route provisioning, live hosted-service grant, unrelated Box-account approval, packaged desktop/device journey, independent security assessment, commit or release was completed. The host URL is opt-in until publisher deployment/default configuration is verified. Earlier direct Box source probes proved confidential-client PKCE, refresh, 35 MCP tools and who_am_i for the developer account; that is not proof of the newly hosted service or public distribution. Detailed session continuation remains in .tmp/connector-auth-service-session-handoff.md."
  source: "2026-09-13 shared connector authentication implementation; docs/connector-auth-service.md; packages/auth-service; hosted-connector-authorization.ts"
- time: "2026-09-14T01:35:48.642Z"
  kind: "evidence"
  summary: "Live unauthenticated initialize probes reproduced Webflow root returning HTTP 200 text/html and confirmed https://mcp.webflow.com/mcp returns HTTP 401 application/json. Webflow's official setup guide specifies /mcp. Local source now corrects the catalog and normalizes exact old root HTTP entries in DaemonConfigStore startup/patch/reload, discarding resource-bound OAuth state for fresh consent while preserving identity, enablement and disabled tools. 65 config-store tests, app/server typechecks and targeted lint passed. This is source-level repair plus public endpoint proof, not authenticated tools/list, installed-app or packaged-release proof. HubSpot live /.well-known/oauth-authorization-server advertises client_secret_post, S256, no registration endpoint, authorization at https://mcp.hubspot.com/oauth/authorize/user and token exchange at https://mcp.hubspot.com/oauth/v3/token. Official HubSpot remote MCP guide requires a registered MCP auth app client ID, secret and callback. Generic DCR cannot complete it; publisher registration and a verified hosted-service adapter remain required. docs/connectors.md now removes HubSpot from the DCR vendor list and documents the boundary. No HubSpot app, credentials or deployment were changed."
  source: "Webflow and HubSpot connector investigation, 2026-09-13"
- time: "2026-09-14T01:58:28.250Z"
  kind: "evidence"
  summary: "User created the Otto HubSpot MCP auth app and explicitly chose the non-staging setup. Added local HubSpot adapter to the existing shared auth service with runtime HUBSPOT_CLIENT_ID/HUBSPOT_CLIENT_SECRET bindings, MCP discovery authorize/token endpoints, automatic fresh S256 PKCE, vendor-owned consent scopes, bounded scope/scopes token-response parsing and the documented refresh-token revocation endpoint. Exact HubSpot HTTP resource routing now uses the existing daemon vault-backed hosted authorization driver. Added production dry-build script and extended the existing Cloudflare local runtime smoke to Box and HubSpot. Validation: 17 grant/protocol tests and 6 daemon hosted-auth tests passed; both vendors passed local Miniflare consent/callback/collection/replay rejection/refresh/revocation using synthetic responses and disabled external network; auth-service/protocol/server/app typechecks and targeted lint passed; production Worker dry build passed. No real HubSpot secret, token exchange, tools/list or public distribution proof is present. Cloudflare CLI read-only whoami reported an expired login; a fresh interactive wrangler login was started in the default browser and is awaiting user completion. Production deployment and credential provisioning remain pending, not successful. Preserve earlier Box/Webflow work in the shared checkout."
  source: "HubSpot shared OAuth adapter and user-selected production setup, 2026-09-13"
- time: "2026-09-14T02:06:52.164Z"
  kind: "evidence"
  summary: "After the user selected non-staging setup and completed Cloudflare CLI authorization, live account checks confirmed the otto-code.me zone active in Draekz Account and no existing otto-auth Worker. Deployed the locally tested shared auth-service source through npm run deploy:production: Worker otto-auth, custom domain auth.otto-code.me, version 7f5e7d63-a87b-4bd6-9f35-6f60e2f34bea. GET https://auth.otto-code.me/health returned HTTP 200 with status ok/version 1. Installed the user-provided HubSpot public client ID as the HUBSPOT_CLIENT_ID runtime secret binding; wrangler secret list confirmed only that binding is present. HUBSPOT_CLIENT_SECRET is still required via the user's secure interactive input. Neither Box credentials nor staging resources were provisioned. No live HubSpot OAuth grant/tool enumeration or installed-daemon configuration/update has been completed. Deployment and health are verified; connector sign-in remains pending."
  source: "Production auth-service deployment after user-selected non-staging setup, 2026-09-13"
- time: "2026-09-14T02:16:38.363Z"
  kind: "evidence"
  summary: "User securely provisioned HUBSPOT_CLIENT_SECRET through Wrangler; runtime binding presence was confirmed without reading its value. Live production verification through https://auth.otto-code.me and the actual ConnectorOAuthBroker/HostedConnectorAuthorization completed OAuth with 72 reported scopes, enumerated 28 HubSpot tools, and exposed the same 28 definitions through ConnectorToolCatalogService. The namespaced get_user_details tool succeeded via the shared catalog handler. Forced access-token expiry triggered a successful refresh, followed by another successful 28-tool enumeration. Disconnect/revocation succeeded. This used a temporary in-memory host vault and removed the test grant; no connector was installed in the running Otto app, and OS-vault/packaged desktop or unrelated-account distribution were not proved. The initial verification helper had a name-lookup mistake after successful enumeration; a corrected second run completed account-read and refresh. No HubSpot content was written. Current host source now defaults to the verified production auth origin; an explicit empty OTTO_CONNECTOR_AUTH_URL disables it and nonempty override remains available. Seven hosted driver tests, server typecheck and targeted lint passed after the default change. Earlier grant/protocol tests, both vendor runtime smokes and production dry build passed. Desktop/daemon changes remain uncommitted and require a host build/release; shared service deployment and developer-account HubSpot lifecycle are live-verified. Box runtime credentials remain unprovisioned on this production service."
  source: "HubSpot production OAuth lifecycle verification, 2026-09-13"
