---
id: "kanban"
kind: "project"
title: "Kanban"
status: "confirmed"
tags: ["kanban","github-projects","jira","project-settings","v0.9"]
delivery_status: "in_build"
progress_completed: 1
progress_total: 5
progress_unit: "0.9 delivery slices"
created_at: "2026-08-27T00:35:28.410Z"
updated_at: "2026-08-27T02:06:52.068Z"
---
# Kanban

<!-- compiled_truth -->

# Kanban

## Outcome

Each Otto project operates one configured GitHub Projects or Jira board for practical daily coordination. The goal is not full tracker parity. It is the minimum real card work needed to move work forward.

## Product contract

A project-configured GitHub Projects or Jira board supports:

- a full practical board read view and explicit refresh;
- create, link, and move;
- supported edits to title, description, status, assignee, labels, priority, and due date;
- external open;
- honest provider capability and authorization disclosure.

A field appears only when the selected provider and board can actually read or write it. Otto does not invent cross-provider parity, obscure a provider failure, or add a separate Kanban credential store.

## Verified current baseline

### Existing end-to-end seams

- **Capability gate:** `server_info.features.kanbanBoard` is the central client gate in `packages/app/src/kanban/kanban-hooks.ts`. The protocol field is optional for old peers, and the client does not create a legacy fallback.
- **Project scope and target storage:** a project carries a non-secret `projectKanban` target. Project Settings stages GitHub/Jira target changes with the page-level Save action, and the daemon normalizes/rejects token-shaped or invalid values before persisting them.
- **Host and project resolution:** `/kanban` selects a Kanban-capable host then a project, preferring current/last workspace context without overriding an explicit Kanban choice. An unconfigured project renders a Project Settings route.
- **Authoritative explicit targets:** GitHub Project URLs retain their user/organization owner alongside the board number; node ids remain direct. The session passes an explicit target to the provider, GitHub resolves it deterministically, and Jira reads that board directly. Old number-only records fall back to the project remote owner.
- **Provider services:** a provider-neutral `KanbanProvider` SPI registers GitHub Projects v2, Jira Cloud, and memory test infrastructure. Both real providers reuse host-owned authentication: GitHub reads the `gh` CLI credential; Jira reads the shared Atlassian email/API-token/site configuration.
- **Board interaction:** the screen loads a board, refreshes it, creates a title-only card, moves it by drag or menu, opens a card URL externally, and shows daemon-supplied GitHub scope recovery with copy/run-in-terminal.
- **Provider implementation:** GitHub Projects reads GraphQL fields/items and mutates item status/create/link; Jira uses the real Agile board configuration and issue transitions, creates Jira tasks, and links a Jira issue key. Jira exposes no writable quick-filter fiction.
- **Focused evidence:** protocol, project-target, provider, session, screen-state, and Project Settings draft tests exist. GitHub remediation detection and cached-credential invalidation are unit-covered.

### Verified gaps and constraints

- Read pagination is bounded rather than complete: GitHub lists 50 boards and reads 200 items/20 fields/50 options in one GraphQL request; Jira lists and reads 100 rows. “Full board” therefore remains unproven.
- The normalized card contract has only title, optional body, status, assignees, URL, and opaque provider id. There is no provider capability descriptor and no wire/model/UI path for card title/description updates, labels, priority, due date, assignee mutation, or field-level editability.
- `kanban.task.link` has protocol/client/server plumbing but no UI caller. In addition, its GitHub numeric issue path is missing resolved project owner/repo context, so it cannot correctly resolve a repository issue number from the screen.
- GitHub Project scope remediation is actionable and provider-neutral on the wire, but the preflight host card only checks generic GitHub hosting authentication. The Atlassian card checks Bitbucket hosting rather than Jira site/board accessibility. Neither is sufficient proof that the configured Kanban provider can operate the selected board.
- Jira transition availability is discovered only while moving. Otto correctly shows an error when a transition is unavailable, but does not yet disclose unreachable target columns before a drag/menu attempt.
- Contract tests use injected HTTP/GraphQL responses. No GitHub sandbox or Jira Cloud sandbox/live proof is recorded, and no Kanban T1/T2 coverage row is yet verified in the release matrix.

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
- The absence of a link UI, field-edit path, board external URL, capability descriptor, Jira preflight, and live proof remains represented as an open ledger row rather than a passing test.

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

## Delivery sequence

1. **Authoritative target resolution** — **completed and unit-verified.** GitHub target identity is preserved, explicit targets flow through the provider boundary, and GitHub/Jira return only the configured board.
2. **Complete bounded reads** — provider pagination/reconciliation and full-board error semantics, with real-shape contract fixtures.
3. **Capability disclosure and auth preflight** — provider/board field-action capabilities plus configured-provider connection checks and remediation.
4. **Practical mutation loop** — finish link with project context, then capability-gated edit fields and post-mutation reconciliation.
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
