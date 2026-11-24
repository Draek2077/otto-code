---
id: "kanban"
kind: "project"
title: "Kanban"
status: "proposed"
tags: ["kanban","github-projects","jira","project-settings","v0.9"]
delivery_status: "partial"
created_at: "2026-08-27T00:35:28.410Z"
updated_at: "2026-11-05T14:23:16.488Z"
---
# Kanban

<!-- compiled_truth -->

# Kanban

## Outcome

Each Otto project operates one configured GitHub Projects or Jira board for practical daily coordination. The goal is not full tracker parity. It is the minimum real card work needed to move work forward.

## Otto 0.10 F18 rebuild

The child implementation at `297dc04e` has been consumed and expanded in the integration checkout `C:/Users/phili/Projects/otto-code/.claude/worktrees/otto-0.10`, branch `otto-0.10/phase-0`. Its uncommitted library handoff is historical provenance, not the present product boundary. Canonical contracts/library are in `packages/plugin/src/otto/kanban/`, daemon composition in `packages/server/src/server/otto/kanban/`, and the built-in client in `plugins/otto-kanban/`. `docs/otto-kanban.md` describes current behavior.

### Integrated implementation and verified proof

- The top-left navigation entry and project-settings contribution are registered. The host/project selection, explicit board target, error/empty/read views and Paseo page gutters are integrated. Dirty action/settings drafts preserve their originating revisions across navigation.
- GitHub Projects v2 reads and create/link/move/supported-edit/detach operations use the daemon's existing official CLI policy. Prior wide/compact synthetic-provider browser journeys cover the rendered action loop; they are not real GitHub mutation acceptance.
- Jira uses the shared daemon-owned Atlassian account and OS-keyring dependency, never a Kanban credential store. Reads, field metadata/edits and native workflow transitions are integrated.
- Commit `a02be92b79f8bb696cbe9b245ba8f3ccb024cb25` adds Link backlog issue via the official enhanced backlog read and Move issues to board action. Only an existing exact same-site board-backlog issue is eligible; the board filter is never changed. Same-host/project/account checks precede writes, placement is read back, and partial/unknown outcomes require reconciliation. Eighteen link cases, six owning-host cases and eight editing cases passed for that change.
- Commit `7d007bba7` adds Create card with explicit board-associated Jira project and non-subtask issue-type selection, complete bounded create metadata, a captured metadata digest rechecked before effects, ADF description, provider-owned defaults, read-back and verified backlog-to-board placement. Unsupported additional required fields are explained and no issue is created; arbitrary create custom fields and subtasks are not promised. Forty-two focused backend/form/structural cases, strict fixture typechecks, normal formatting/lint and normal workspace hooks passed. This proves source/contract behavior, not real Jira or device acceptance.
- Durable operation admission, settings/board/card revisions, permission metadata and uncertain-outcome blocking remain shared across provider actions. No provider write has been issued against a real board during this integration.

### Remaining full-feature gates (reconciled 2026-11-05)

Current verification source is 1b4c76aa615e20e91f09985c8f0ac7343178c41c on otto-0.10/phase-0. Full CI 41958046132 passed every job; Otto App Acceptance 41956398828 passed all 71 journeys. Windows/Linux, unsigned Intel/Apple Silicon Mac, Android APK+AAB, Nix and Docker builds passed at c0130fdbe5c75271e98f3556af4084a5cea96c0c; final successors change only tests/docs, with identical production/packaging inputs. These are CI/fixture and packaging results, not live vendor permissions, real model/GPU or physical-device acceptance. No installed Otto change or release occurred.

Kanban has integrated navigation/settings, GitHub/Jira reads/actions and shared agent tools. Current wide/compact app journeys prove configured GitHub reads/actions and reconciliation through a controlled official-CLI fixture, not real tracker mutations. The old report that Brain's failing model-load case prevents reaching Kanban is historical; the final 71-journey run completed successfully.

Jira browser/daemon action acceptance, controlled official-provider read-back and remediation, real GitHub/Jira credentials/board permissions and physical/native interaction still require evidence. Preserve the entire completion ledger and exact provider semantics; registration, synthetic GitHub success and green builds do not complete full F18. The earlier 0/5 child checkpoint counter is not a current implementation percentage and is removed rather than replaced with an invented completion claim. Review is requested; no new provider writes or implementation start is authorized by this reconciliation. Wider Atlassian/Bitbucket scope retains daemon-owned shared authorization.

## Product contract

A project-configured GitHub Projects or Jira board supports:

- a full practical board read view and explicit refresh;
- create, link, and move;
- supported edits to title, description, status, assignee, labels, priority, and due date;
- external open;
- honest provider capability and authorization disclosure.

A field appears only when the selected provider and board can actually read or write it. Otto does not invent cross-provider parity, obscure a provider failure, or add a separate Kanban credential store.

## Frozen 0.9 source baseline

### Code and focused verification

- A project stores a non-secret GitHub Projects v2 or Jira board target. Project Settings stages that target with Save; Kanban selects its host and project and resolves an explicit target rather than choosing an arbitrary accessible board.
- The daemon owns GitHub `gh` CLI and shared Atlassian credentials, provider requests, and normalized board responses. GitHub GraphQL documents now validate against the live schema (22 checked, 0 invalid). This proves document validity, not that a real board accepts a read or mutation.
- GitHub item and field pages, Jira issue pages, card fields, card updates, linking, movement, and GitHub board-item removal are implemented. Bounded or overflowing provider data produces an explicit error instead of a knowingly partial board. Jira edits use per-issue `editmeta`; GitHub board changes use polling.
- The app has a card detail editor, link and remove actions, provider error display, and board re-read after mutations and GitHub change notifications. Card fields remain in the response sidecar because the board/card wire schemas are strict.
- The optional Kanban Otto tool group exposes list, get, create, link, move, update, and delete. Tools resolve the caller's configured project board and apply workspace access permission gates.
- Focused evidence on 2026-09-27: 97 Kanban provider/tool tests, 2 card-detail UI tests, and 41 workspace permission tests passed; protocol/client build, server and app typechecks, targeted lint, formatting, and `git diff --check` passed. `docs/kanban.md` describes this implementation and its proof boundary.

### Remaining release gates

- No configured GitHub Projects or Jira board was exercised end to end. The repository owner `Draek2077` had zero visible GitHub Projects under the active `gh` credential on 2026-09-27. Injected provider responses and live schema validation do not prove provider acceptance.
- The charter's T1 and T2 release journeys, a controlled provider mutation/read-back, operation-specific Kanban auth preflight, and provider-supplied board external-open behavior remain unverified or unimplemented. The preflight host cards are still generic hosting checks.
- Jira transition availability is checked on move, not before a drag/menu choice. Jira cannot remove a board card through this provider. GitHub polling is periodic, not a push webhook.
- The completion ledger stays open and the project remains in build. A passing code fixture is not a completed end-user provider proof.

## 0.9 delivery inventory

### 1. Entry, scope, and target configuration

- Host/project selection is project-scoped, preserves the reader’s explicit selection, and handles no-host/no-project/unconfigured/loading/error states.
- Project Settings offers only actual configured adapters, accepts GitHub board number/node-id/URL and Jira board id/URL, rejects credential-like input, shows host-auth ownership, and participates in staged Save and unsaved-change protection.
- The daemon normalizes a target into enough non-secret identity to resolve it deterministically. An explicit GitHub or Jira target returns that one board, not an arbitrary accessible board; GitHub’s empty target remains the documented repo-derived discovery mode.
- Existing target records remain readable. Additive fields stay optional on the wire and persisted records receive deterministic compatibility interpretation, never silent reassignment.

### 2. Host auth, provider discovery, and remediation

- GitHub auth remains owned by the `gh` CLI. The host card states the Projects scopes `read:project`, `project`, and `repo` where private content requires it; scope failures offer the daemon-resolved `gh auth refresh -s read:project,project` route and invalidate stale initialized credentials.
- Jira remains owned by the shared Atlassian account configuration, including the non-secret site origin. The host card validates the Jira-capable credential/site path, states the required Jira scopes, and routes actionable credential/site failures back to that card.
- Board and card operations disclose a provider’s concrete supported read/write fields and action limits. Feature support is not inferred from the provider name alone when a board configuration makes it unavailable.

### 3. Normalized board model and reconciliation

- Board reads preserve provider-native opaque ids internally while exposing one normalized board/card contract to the UI.
- Reads paginate until the configured board is complete or the provider supplies an explicit bounded/error state. Refresh reconciles from provider truth after every mutation; it does not retain a stale optimistic board.
- The service handles deleted boards/cards, changed fields/status mappings, rate limits, malformed provider payloads, and partial page failures with actionable error/retry behavior.
- Provider caches are scoped to a board and invalidated after relevant mutations or credential refresh.

### 4. Practical board UI

- The screen exposes the selected host, project, and board where more than one exists; refresh retains selection when it remains valid.
- It renders loading, empty, unconfigured, error/remediation, and board states without hiding a meaningful failure behind an empty list.
- Cards show the supported normalized metadata without visual promises for unsupported fields. A card offers external open only when the provider supplied a user-facing URL. The configured board itself has an external-open action when its provider exposes a user-facing board URL.
- The UI accommodates desktop and compact layouts using established controls and theme primitives.

### 5. Mutations and edit semantics

- **Create:** creates a provider-native work item/card in a chosen column, with supported title/body inputs and reconciliation.
- **Link:** lets the user choose/link a supported existing issue or PR using project context, prevents/handles duplicate links, optionally places it, and reconciles.
- **Move/status:** moves only to provider-valid status/column targets. Jira transition failures identify the provider constraint; synthetic unassigned columns remain read-only.
- **Edit:** title, description, assignee, labels, priority, and due date are exposed individually only where provider/board capability permits. Each mutation is user-initiated, daemon-side validated, error surfaced at the action scope, then re-read from provider truth.
- Unsupported fields are omitted or explained by the centralized capability disclosure. Otto does not silently store local shadow values.

### 6. Protocol and compatibility

- Keep current envelopes backward-compatible. New wire fields are optional additive leaves; schemas remain structural and use dotted request/response namespaces.
- A new Kanban feature capability, if required, lives once in `server_info.features.*` with a dated `COMPAT(...)` marker. Old hosts show the upgrade boundary rather than executing an emulated legacy path.
- Provider ids and capability names remain forward-tolerant on the wire. Provider-specific ids, tokens, site URLs, and error objects never leak through the normalized UI contract.

### 7. Provider, security, and runtime boundary

- GitHub uses `gh` credentials and GraphQL only through the daemon. Jira uses daemon-stored shared Atlassian Basic credentials against the configured site origin. No secret is added to a project record, URL, client payload, or log.
- Every mutation revalidates target/card/field preconditions daemon-side, is issued only from explicit user intent, and follows bounded retry/rate-limit policy.
- Forge, Kanban, and free-form Connectors remain separate product boundaries. They may reuse daemon authorization plumbing but never treat connector credentials or arbitrary MCP tools as Kanban configuration.

### 8. Documentation and proof

- Document the durable product contract, target configuration, support/capability matrix, credential remediation, and explicit non-goals in `docs/` and its index when the product behavior is verified.
- Documentation describes only proven behavior and labels each provider/field limitation. It never presents server-only paths, bounded reads, or unverified provider behavior as a user capability.
- Add focused provider contract fixtures that pin real GitHub GraphQL and Jira REST shapes, pagination, errors, target resolution, and mutation preconditions.
- Add T1 host → project → configured target → board → refresh/create/link/move/edit/remediation coverage with a money-shot; add T2/local-daemon proof where the daemon journey is material.
- Record controlled GitHub and Jira sandbox/live proof, or the vendor/credential gate that prevented it, in the release evidence. Unit fixtures do not substitute for provider proof.

## Verification strategy and release evidence

### Proof hierarchy

No one tier is enough to establish an end-user feature. Evidence is cumulative:

| Tier | Establishes | Does not establish |
| --- | --- | --- |
| Focused unit and provider-contract fixtures | Normalization, backward compatibility, requests, pagination cursors, provider error mapping, and mutation preconditions. | A rendered user workflow or real vendor acceptance. |
| UI state tests | Loading, empty, unsupported, remediation, disabled controls, and action-scoped mutation errors. | Daemon transport or provider behavior. |
| T1 app E2E | A user can complete the rendered workflow against deterministic daemon fixtures. | That GitHub or Jira accepts the operation. |
| T2 daemon E2E | Client-to-daemon protocol, capability gates, target persistence/migration, and host/project scope. | External provider behavior. |
| Controlled sandbox/live provider proof | The released integration works with a real GitHub Projects board or Jira Cloud board. | More than the exercised provider/account/board configuration. |

A mock or fixture is required for determinism but never substitutes for the applicable real-provider run.

### Audit the claims already made

Before expanding the feature, keep the existing claims honest with focused tests:

- Configured GitHub URL, node-id, Jira id, and legacy number-only target resolve only their intended board, never the first accessible board.
- Old and new project records and protocol envelopes parse in both directions under the documented compatibility boundary.
- Project Settings persists the target; host/project selection survives navigation and opens the selected project scope.
- Refresh, create, move, card external open, and GitHub scope remediation have a UI-state or T1 assertion in addition to provider request fixtures.
- Current bounded-read limits are tested as limits, not passed off as complete-board proof.
- The absence of board external-open, operation-specific Jira preflight, T1/T2 release journeys, and live provider proof remains represented as open ledger work rather than a passing test.

### Final release journeys

Run this journey independently for a seeded GitHub Projects board and a seeded Jira Cloud board:

`host → project → configure exact board → complete read across more than one page → refresh → create → link existing work → move → edit each supported field → external open → authorization/remediation → provider-side reconciliation`

The seeded boards must exceed one provider page and include an unsupported/unreachable field or transition, so the test proves both successful work and truthful capability disclosure.

### Required coverage

- Provider contract fixtures cover real GitHub GraphQL and Jira REST pagination, malformed payloads, rate limits, deleted cards/boards, invalid transitions, duplicate links, and every supported field mutation.
- T1 covers the rendered user journey and its money-shot for each provider; T2 covers actual app/daemon transport, capability gate, target storage, and migration.
- Sandbox/live verification independently reads provider truth after Otto creates, links, moves, or edits a card. Record account/board setup, test date, assertions, and result without storing credentials.
- Security checks prove tokens, credentials, and raw provider error payloads are absent from project records, client payloads, and logs.
- Documentation review maps every end-user claim to a satisfied Completion ledger row and its evidence. A claim with no completed row is omitted or labelled unavailable.

## Completion ledger

The release question is not “does a board render?” It is “can an end user complete the advertised workflow on either supported provider, and can Otto explain when that workflow is unavailable?” The plan is complete only when every row is satisfied.

| Capability | Done only when | Not done if |
| --- | --- | --- |
| Project setup and scope | A user can choose a host and project, save a non-secret target in Project Settings, reopen Kanban, and reach that exact target; old targets retain deterministic meaning. | The UI selects an arbitrary accessible board, configuration is unsaved or undiscoverable, or migration changes a target silently. |
| Practical complete read | GitHub and Jira pagination/reconciliation reach all accessible items and columns for the configured board, or surface a clear provider-bounded/error result. | One fixed first page can masquerade as the whole board. |
| Refresh and recovery | Refresh and every successful mutation re-read provider truth; deleted board/card, rate limit, malformed payload, and partial-page failures leave an actionable retry/remediation state. | Stale optimistic data remains visible or a meaningful failure looks like an empty board. |
| Create | The UI collects each supported create field, creates in the intended column, handles provider validation errors, then shows reconciled truth. | A server-only or title-only path is documented as general card creation. |
| Link | The UI selects an existing supported issue/PR with the resolved project repository context, detects duplicates/invalid targets, optionally places it, and reconciles. | The RPC exists but users cannot invoke it, or a numeric GitHub issue can resolve against the wrong repo. |
| Move/status | Only provider-valid targets are actionable; Jira unavailable transitions and read-only synthetic columns are visible before or at intent, then the resulting state is re-read. | A drag/menu promises a move that the provider cannot make, or failure has no usable explanation. |
| Supported field edits | Title, description, assignee, labels, priority, and due date each have independent provider/board capability, normalized read/write semantics, UI affordance, validation, and post-write reconciliation. | Any contract field is claimed because another provider supports it, because it was read-only, or because it is stored locally instead of remotely. |
| Capability disclosure | Before action, users can see which fields/actions this exact provider and board support, why an action is absent, and whether an upgrade is required. | Support is guessed solely from “GitHub” or “Jira,” or unsupported controls simply disappear without explanation where context matters. |
| Authorization and remediation | The configured GitHub board and Jira site/board both have operation-specific preflight; missing scope/site/credential failures lead to an actionable host-owned remedy without leaking secrets. | Generic hosting auth is treated as proof that Kanban works, or Jira failures have no route to repair. |
| External open | Cards and the configured board expose external-open only for provider-supplied user-facing URLs, using the existing safe open path. | The contract promises external open but only an opaque card id exists or board open is absent. |
| Compatibility and security | New protocol/capability data is additive, gated once, secret-free, and daemon-validated; old clients/hosts preserve the documented upgrade boundary. | New code depends on a required wire field, leaks provider data, or emulates missing daemon functionality through legacy calls. |
| Contract and live proof | GitHub and Jira fixtures cover real response/error/pagination/mutation shapes; targeted T1/T2 journeys and controlled sandbox/live provider evidence demonstrate the released workflow. | Only unit mocks pass, a provider has not exercised its advertised path, or evidence does not match the released UI. |
| End-user documentation | `docs/` plus its index provide setup, a provider-field support matrix, remediation, external-open behavior, and non-goals drawn solely from proven rows above. | Documentation claims “full board,” “edit,” “link,” or provider parity before their ledger rows are proven. |

A row may be marked complete only with linked evidence naming the relevant fixtures/tests and provider proof. “Implemented” is not a substitute for a satisfied row. The charter remains in build while any required row is open; it is not a candidate for `complete` on aggregate progress alone.

## Historical 0.9 delivery sequence

1. **Authoritative target resolution** — **completed and unit-verified.** GitHub target identity is preserved, explicit targets flow through the provider boundary, and GitHub/Jira return only the configured board.
2. **Complete bounded reads** — implemented and focused-test verified for GitHub and Jira, with explicit overflow errors; live board acceptance remains open.
3. **Capability disclosure and auth preflight** — field and action disclosure is implemented; configured-provider preflight remains open.
4. **Practical mutation loop** — tool and UI paths for link, edit, move, and supported removal are implemented and fixture-tested; provider mutation/read-back remains open.
5. **Release proof and end-user documentation** — T1/T2/live-sandbox journeys, support matrix, setup/remediation documentation, and matrix/runbook evidence.

## Explicit non-goals

- Full GitHub Projects or Jira administration, arbitrary custom-field parity, sprint/backlog planning, comments/attachments/history, bulk editing, automations, reports, and a general tracker API.
- New tracker providers in 0.9.
- A Kanban-specific token store or client-owned credentials.
- Local shadow fields, fake capability parity, silent fallback to a different board, or a degraded new-feature path on older daemons.
- Publishing aspirational user documentation in place of an evidence-backed provider support matrix.

## Acceptance

For a host and project, a user can save a GitHub Projects or Jira target and Otto opens that target deterministically. The user can read and refresh its complete practical board, create/link/move a card, edit the provider-supported baseline fields, open externally, and understand exactly what is unsupported or how to repair authorization. Each provider has contract fixtures and controlled live/sandbox evidence.

The feature is complete only when the Completion ledger is entirely satisfied with current release evidence; progress percentage alone never establishes completion.

## Timeline

- time: "2026-08-27T00:35:28.410Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors","e2e-qa-coverage"]
- time: "2026-08-27T00:35:28.410Z"
  kind: "evidence"
  summary: "Initial 0.9 charter created from user direction and the existing Otto implementation/Knowledge inventory on 2026-08-26. This charter is confirmed as the feature-level planning record and will be expanded with verified current-state and delivery evidence."
- time: "2026-08-27T01:48:03.306Z"
  kind: "decision"
  summary: "The user directed a 0.9 Kanban inventory and adversarial completeness review before implementation. Source inspection verified the existing seams and exposed a missing authoritative-explicit-target path that must be the first coherent delivery slice."
  source: "Implementation audit, 2026-08-26: packages/protocol/src/kanban.ts; packages/server/src/server/kanban/{kanban-session,github-provider,jira-provider,project-targe"
  affects: ["release-0-9-product-completion","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","github-atlassian-jira-token-scopes-required-for-the-kanban-providers","e2e-qa-coverage"]
- time: "2026-08-27T01:54:05.533Z"
  kind: "note"
  summary: "Completed and verified delivery slice 1: explicit project targets now constrain GitHub Projects and Jira provider discovery. GitHub Project URLs retain their owner so a board number is deterministic; old number-only records fall back to the project remote owner. Pagination, capability-gated editing/link UI, Kanban-specific auth preflight, and live/sandbox proof remain open."
  affects: ["kanban"]
- time: "2026-08-27T01:54:12.194Z"
  kind: "evidence"
  summary: "Implemented authoritative configured-board resolution. `ProjectKanbanTargetSchema` and persisted project records accept optional `boardOwner`; `normalizeKanbanProjectTarget` derives it from GitHub Projects URLs. `Session.resolveKanbanProjectTarget` retains URL owner or falls back to the project remote owner. `KanbanSession` passes the explicit target through `KanbanBoardListContext`; GitHub resolves a number against that owner or a node id directly, and Jira reads only `/rest/agile/1.0/board/{id}`. Focused protocol + server tests: 10 files, 104 tests passed. `npm run build:client`, protocol typecheck, server typecheck, targeted lint and formatting checks passed. No GitHub/Jira live or sandbox provider proof was run."
  source: "Focused verification, 2026-08-26"
  affects: ["release-0-9-product-completion","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per"]
- time: "2026-08-27T01:54:41.748Z"
  kind: "decision"
  summary: "Reconciled the charter’s current baseline after the verified first implementation slice so it no longer describes the fixed explicit-target defect as an open gap."
  source: "Focused Kanban verification, 2026-08-26"
- time: "2026-08-27T02:01:48.465Z"
  kind: "decision"
  summary: "The user requested that the 0.9 Kanban plan incorporate the end-user capability assessment and provide an auditable answer to whether the plan is complete. The charter now makes each contract promise a falsifiable completion gate, including documentation and proof."
  source: "Kanban source and charter assessment, 2026-08-26; user direction, 2026-08-27"
  affects: ["release-0-9-product-completion","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","github-atlassian-jira-token-scopes-required-for-the-kanban-providers","e2e-qa-coverage"]
- time: "2026-08-27T02:06:52.068Z"
  kind: "decision"
  summary: "The user directed that the charter capture how current software assertions and final end-user claims will be tested. The plan now defines cumulative proof tiers, current-claim audit tests, per-provider release journeys, and evidence requirements."
  source: "Kanban completion assessment and user direction, 2026-08-27"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-09-28T00:51:32.497Z"
  kind: "note"
  summary: "Slice 2 (complete bounded reads) is done for GitHub Projects v2, and the charter's \"Verified current baseline\" claim that the provider \"reads GraphQL fields/items and mutates item status/create/link\" is withdrawn as false: every GraphQL document in github-provider.ts was invalid against the real schema, so no board read or mutation had ever succeeded. See [[finding-2026-09-27-kanban-github-graphql-invalid]]. All 22 documents are now proven valid against the live schema by `npm run validate:kanban-graphql -w @otto-code/server`, item reads paginate, and card field read/write, card delete and a polling freshness watcher are served end to end on the daemon. Remaining in this effort: Kanban Otto tools as an optional tool group, the client UI for field editing / link / delete / auto-refresh, Jira field parity, and docs/kanban.md. No live GitHub board has been exercised."
  affects: ["kanban"]
- time: "2026-09-28T01:53:44.666Z"
  kind: "evidence"
  summary: "Implemented the optional Kanban Otto tool group (list/get/create/link/move/update/delete) with caller-project board scoping and workspace access permission gates; added the app card-detail editor, link and delete actions, and handling of polling board-change notifications; Jira now derives editable fields per issue from editmeta and writes supported values, including ADF textarea fields. Added docs/kanban.md and its index entry, with explicit provider and proof limits. Verification: GitHub live schema validation accepted 22/22 GraphQL documents; focused Kanban/provider/tool tests passed 97/97, card-detail UI tests 2/2, and workspace access tests 41/41; protocol/client build, server and app typechecks, targeted lint, formatting, and git diff --check passed. No real GitHub or Jira board mutation, T1/T2 release journey, or operation-specific auth preflight was exercised. Keep the charter in_build at 2/5 delivery slices; these implementation and fixture checks do not satisfy its live-proof completion ledger."
  source: "Kanban implementation and focused verification, 2026-09-27"
  affects: ["kanban","e2e-qa-coverage"]
- time: "2026-09-28T01:56:54.267Z"
  kind: "decision"
  summary: "Replace the invalid provider-read baseline and stale gap list with the focused evidence from the Kanban tool, UI, Jira field, documentation, and GraphQL validation work. Preserve the open end-to-end and provider-proof gates. Status returned to proposed for review."
  source: "User withdrawal of the prior baseline claim and focused Kanban verification, 2026-09-27"
  affects: ["kanban","e2e-qa-coverage"]
- time: "2026-10-23T19:35:55.640Z"
  kind: "decision"
  summary: "User directed a new clean-Paseo F18 implementation and asked to preserve full behavior and exact required shared seams on its feature charter. Reconcile current 0.10 ownership/proof boundary while explicitly retaining 0.9 implementation and evidence as historical reference; no completion or review confirmation."
  source: "2026-10-23 F18 handoff and parent boundary directions; supplied branch 297dc04e; authorized three-file 48-case fixture pass followed by unverified review additi"
  affects: ["otto-0-10-clean-paseo-rebuild","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","github-atlassian-jira-token-scopes-required-for-the-kanban-providers"]
- time: "2026-10-23T19:36:12.970Z"
  kind: "note"
  summary: "Start the new 0.10 proof-gated checklist at 0/5. Historical 0.9 2/5 delivery evidence remains in the charter/timeline and does not transfer to clean Paseo. F18-01 source is prepared, with the initial 48 fixture cases passing; review additions and required formatting/typecheck/hooks/exact-source CI are still unverified. Full F18 is incomplete."
  affects: ["kanban"]
- time: "2026-10-23T19:45:24.628Z"
  kind: "evidence"
  summary: "Parent verification of the isolated Otto 0.10 F18 draft: normal npm-script formatting and own-root lint passed (11 TS files, zero warnings/errors); a noEmit strict isolated TypeScript config with read-only existing declarations passed; the final three fixture files pass 26 project-config + 9 read-service + 16 GitHub-reader cases (51 total), sequential one worker. New refactored GitHub board pagination/limits are included in this final local proof. Source remains uncommitted on otto-0.10/kanban at base297dc04e. This is library/adapter fixture evidence only: no registered UI, shared host/project/forge contract, live vendor acceptance, full workspace hook/typecheck, exact-source CI/build or merge is claimed. No installs, credential changes, vendor writes, app/model launches or installed Otto changes occurred."
  source: "Parent local checks in C:\\Users\\phili\\.otto\\worktrees\\0pkiflkb\\otto-010-kanban, 2026-10-23; prepared .tmp/kanban-tsconfig.json and existing fixture config."
- time: "2026-10-23T21:03:44.741Z"
  kind: "evidence"
  summary: "After the full F18 goal resumed, prepared additional unregistered source-only plugin UI and typed RPC/contribution factories under plugins/otto-kanban/client/, shared/rpc.ts and server/contribution.ts. The existing 13-path library checkpoint and parent-reported 51 passing cases remain unchanged. New source covers host-bound project selection (using the existing PluginSurfaceScreen HostFilter), loading/error/unconfigured board states, wide/compact board controls, project-target Save with expectedRevision, failed-save draft retention, project-picker locking during settings, and retaining same-host project data during background refresh. New project-selection, target-form and RPC-boundary fixtures are authored but NOT RUN; UI/static checks, rendered/native behavior, integration and exact-source CI remain unverified. server/mutation-port.proposed.ts is a type-only proposal with expected settings/board/card revisions and reconciliation-required outcomes; no vendor writes were implemented. Required shared project metadata and forge-auth bridges, registry/protocol/SDK integration remain parent-owned and unimplemented here. Current SDK also lacks a typed active/last workspace hint, canonical project-settings section navigation, and an unsaved-draft leave guard for the outer host filter/close path; proposed API names must be reviewed rather than importing private app code. Explicit source-only/no-new-validation-until-grant instructions remain in force; the requested bounded validation window is unanswered. The same authorization/integration hold was revalidated over three consecutive no-progress goal turns. All changes remain uncommitted on otto-0.10/kanban at 297dc04e; no installation, hook bypass, runtime/vendor launch, shared-core edit or completion claim occurred."
  source: "F18 full-goal continuation and source-only handoff; local source/charter readback at base 297dc04e, 2026-10-23"
- time: "2026-10-24T12:37:14.125Z"
  kind: "evidence"
  summary: "Reviewed daemon prerequisite committed at 15bd299e6 and included in pushed 537ba64a9, whose 21 CI jobs passed: OttoProjectMetadata reads preserved raw project fields and updates only owned Kanban/Knowledge fields under the SAME FileBackedProjectRegistry mutation queue. Record revision checked under queue; corruption, duplicate IDs, archive/delete and unknown fields preserved. Eleven isolated filesystem fixtures, targeted lint/format, production server strict check, strict fixture check and normal hooks passed. Raw records remain daemon-internal; this is not a new wire schema or reachable UI. External editors do not share this queue. No checkpoint completion or full feature claim. Kanban canonical host-library relocation is separately committed locally at 2576e29a3; its focused RPC/host-client boundary checks and owning builds/typechecks pass, remote CI pending."
  source: "Otto integration commit 15bd299e6"
- time: "2026-10-24T15:03:37.983Z"
  kind: "evidence"
  summary: "Verified integration checkpoint, not full F18 completion: Kanban is registered in the top sidebar and its target form is reachable in canonical Project Settings. At 102b2d62a06ee80e9ad1b4f90cd25d6baf4cf812, Otto App Acceptance run 40102211852 passed wide/compact configured-board reads, paginated fields/cards, actual external opening, scope-error display and explicit refresh recovery through the real isolated daemon and local-fixture gh adapter. Screenshots were inspected. Navigation/configuration/conflict journeys also passed. Commit 59ad3f80dcad7ccde2fbc6fb59b94de2bed48e74 corrected the older sidebar preference assertion to retain Kanban; full CI run 40102895927 and Otto App Acceptance 40102895995 both succeeded. These are synthetic tracker/browser proofs, not native/device or live vendor acceptance. GitHub action integration is now being implemented and is not covered by these green SHAs; Jira, MCP restoration, remaining acceptance and all-product exact-source builds remain open. Full charter/checkpoint totals are unchanged."
  source: "GitHub Actions / otto-0.10/phase-0"
- time: "2026-10-25T22:11:23.781Z"
  kind: "decision"
  summary: "Reconcile the authorized sequential F18 integration and newly verified official Jira link/create implementation while retaining the full completion ledger and real-provider/browser/exact-source build limits. The obsolete child-only boundary is now historical; full feature completion is not asserted."
  source: "docs/otto-kanban.md; commits a02be92b79f8bb696cbe9b245ba8f3ccb024cb25, 7d007bba7; focused fixture logs and normal commit hooks."
- time: "2026-11-05T14:22:44.101Z"
  kind: "decision"
  summary: "Philippe requested accurate checklist reconciliation and review. Replace stale child-only/pending/failed-run claims with current integrated behavior and final green CI, preserving unproved native/provider/vendor/product acceptance gates and parked research. No feature or review confirmation is granted."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["otto-0-10","restoration-checklist","review"]
- time: "2026-11-05T14:23:16.488Z"
  kind: "note"
  summary: "The implementation has been integrated and has current full CI/app/build proof, so the historical child-handoff zero-percent counter is misleading. Remove that obsolete metric without inventing completed release slices. Keep partial delivery and every remaining native/provider/product acceptance requirement open, as requested during Philippe's checklist review."
  affects: ["kanban"]
