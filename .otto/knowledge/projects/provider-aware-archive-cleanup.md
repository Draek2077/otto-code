---
id: "provider-aware-archive-cleanup"
kind: "project"
title: "Provider-aware archive cleanup"
status: "confirmed"
tags: ["history", "archive", "cleanup", "providers", "acp", "storage"]
delivery_status: "partial"
progress_completed: 1
progress_total: 2
progress_unit: "major delivery slices"
created_at: "2026-08-09T16:05:18.071Z"
updated_at: "2026-08-09T16:20:26.258Z"
---

# Provider-aware archive cleanup

<!-- compiled_truth -->

# Provider-aware archive cleanup

## Objective

Extend History cleanup so users can choose between removing only Otto's archive record and removing Otto's record plus provider-owned persisted session data. The feature must report only bytes that the selected action will actually delete.

The existing behavior remains available as the safe default: Otto deletes its own agent record and deliberately leaves provider transcripts untouched.

## User choices

Expose two explicit cleanup scopes:

- Remove from Otto: delete the Otto agent record and metadata only.
- Remove from Otto and provider: delete the Otto record plus provider session data, but only when the host and provider adapter can prove that cleanup is supported and safe.

The confirmation dialog must state the selected scope, matched chat count, exact reclaimable bytes for that scope, active-chat impact, and the fact that provider transcripts remain when the Otto-only scope is selected. The provider scope must warn that the chat cannot be resumed or recovered after successful provider cleanup.

Unsupported provider cleanup must never silently downgrade a request that the user understood as provider deletion. The UI must show unsupported items and require an explicit Otto-only choice or leave them undeleted.

## Scope and ownership model

Provider cleanup is provider-owned functionality, not a generic transcript-file unlink.

Add a daemon-side provider cleanup contract that can:

1. Inspect a persisted session using the stored provider and persistence handle.
2. Return a deletion manifest containing the provider-owned resources, byte sizes, ownership/reference information, and a stable validation token.
3. Delete those resources through a provider-native API or a tightly scoped provider adapter.
4. Report supported, unsupported, stale, failed, or deleted outcomes with safe error details.

The contract must refuse deletion when a resource is shared by another Otto agent, has changed since inspection, cannot be mapped unambiguously to the session, or is controlled by a remote provider without a deletion API.

The manifest is captured when archiving after the provider has stopped or flushed. It avoids rereading transcript contents during History rendering. At deletion time, revalidate metadata such as identity, size, mtime, inode or provider revision before deleting.

The displayed size must be the exact bytes expected to be deleted by the selected scope. Provider bytes and Otto record bytes must be tracked separately. Failed or stale resources must not be included in the reclaimable total.

## Provider and ACP behavior

Direct providers can opt into cleanup only after implementing their own adapter:

- Claude, Codex, OpenCode, Pi, OMP, and future direct providers must each identify their canonical persisted session resources.
- Prefer an official provider delete operation where one exists.
- If local files are the provider's documented storage, delete only exact manifest entries after validation.
- Account for parent and observed-subagent relationships and shared session resources.
- Do not invoke arbitrary shell commands generated from provider paths.

ACP providers default to unsupported because ACP does not inherently grant Otto ownership of the provider's durable session store. An ACP provider may opt in only if its protocol or adapter exposes an explicit, provider-approved delete operation and returns a verifiable deletion result. Remote sessions must never be treated as local files.

Deleting provider data is expected to make provider resume/history fail for that session. Otto must not advertise the row as resumable after successful cleanup.

## Lifecycle and failure semantics

Archive:

1. Stop or cancel the agent and allow provider writes to settle.
2. Persist the Otto archive state.
3. Ask the provider cleanup adapter for a manifest.
4. Persist the manifest and both Otto/provider byte totals in the archived record or a daemon-owned cleanup index.
5. Publish the archived row.

Clear with Otto-only scope:

1. Select archived records using the existing server-side pagination-safe sweep.
2. Delete Otto records.
3. Leave provider data unchanged.

Clear with provider scope:

1. Select archived records.
2. Validate every selected cleanup manifest.
3. Present dry-run counts, bytes, unsupported items, and stale items.
4. On confirmation, process each item independently.
5. Stop/cancel any unexpectedly live runtime.
6. Revalidate and perform provider cleanup.
7. Delete the Otto record only after provider cleanup succeeds.
8. Keep the Otto record when provider deletion fails, so the user can retry or choose Otto-only cleanup.
9. Return per-item outcomes and bytes actually reclaimed.

The operation must be idempotent. A missing provider resource should be treated as already deleted only when the provider adapter can establish that it belonged to the target session. Otherwise report an uncertain failure and retain the Otto record.

## Protocol and compatibility

Extend the existing history cleanup protocol additively:

- Add an optional cleanup scope enum such as otto and otto_and_provider.
- Add optional per-entry cleanup capability and byte fields to history entries.
- Add optional dry-run provider outcome summaries and actual reclaimed byte totals.
- Add a host capability flag under server_info.features, with the required dated COMPAT(...) cleanup comment.
- Keep all new fields optional so old clients and daemons continue parsing messages.
- Detect the feature in one client capability gate. Do not scatter fallback branches through the History UI.
- New provider cleanup RPCs must use dotted request/response namespaces.

Old daemons continue to support Otto-only cleanup. New clients show Update the host to use this for provider cleanup when the host capability is absent.

## UI

History rows:

- Show a right-aligned size column only for archived chats.
- Use the exact clearable total for the currently selected scope.
- Show an unavailable or unsupported marker rather than a guessed size.
- Keep active rows blank.
- Preserve the current host column and responsive behavior. On compact layouts, move the size into archived row metadata or omit it if space is insufficient.

Cleanup UI:

- Add a scope selector to the clear-archive confirmation flow.
- Run a real dry run before destructive confirmation.
- Quote count and bytes for the chosen scope.
- Break down unsupported or stale provider sessions before confirmation.
- Never imply provider transcripts are deleted when the selected scope is Otto-only.
- Preserve the existing two-paragraph compact confirmation style and no-em-dash copy requirement.

## Likely implementation areas

- packages/protocol/src/messages.ts: optional cleanup scope, manifest summary, capability fields, and response outcomes.
- packages/protocol/src/agent-types.ts and packages/server/src/server/agent/agent-sdk-types.ts: provider cleanup contract types.
- packages/server/src/server/agent/agent-storage.ts: persisted cleanup manifest/index and exact Otto record byte accounting.
- packages/server/src/server/agent/lifecycle-command.ts and packages/server/src/server/session.ts: archive-time inspection, dry run, provider cleanup ordering, partial failures.
- Provider adapters under packages/server/src/server/agent/providers/: opt-in implementations and tests.
- packages/app/src/hooks/use-agent-history.ts, packages/app/src/types/agent-directory.ts, and packages/app/src/components/agent-list.tsx: archived size projection and right-aligned rendering.
- packages/app/src/screens/sessions-screen.tsx, packages/app/src/history/, and translations: scope selection, confirmation copy, dry-run summaries.
- Existing history, lifecycle, protocol, and provider tests.

## Acceptance criteria

- Otto-only cleanup deletes exactly Otto records and reports only those bytes.
- Provider cleanup is never attempted for unsupported ACP or remote providers.
- Provider cleanup never deletes an unvalidated, shared, changed, or ambiguous resource.
- A provider deletion failure leaves the Otto record available for retry.
- Successful provider cleanup followed by Otto deletion cannot be presented as resumable.
- Dry-run bytes equal the bytes reported as reclaimed after successful deletion, within filesystem/provider accounting rules documented by the adapter.
- Multi-host cleanup reports results and bytes per host and aggregates them correctly.
- Old clients and old daemons continue to parse all updated messages.
- New clients gate provider cleanup through one capability check and provide an explicit upgrade message.
- Archived rows show size; active rows do not.
- Targeted protocol, server lifecycle, provider, app, and translation tests pass.
- Typecheck, lint, and formatting pass. No full local test suite.

## Non-goals

- Deleting arbitrary provider files discovered by directory scans.
- Removing provider data by default.
- Reconstructing transcript sizes on every History render.
- Promising deletion for providers whose protocol does not support it.
- Deleting shared attachments globally as part of chat cleanup.

## Timeline

- time: "2026-08-09T16:05:18.071Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-size-reports-clearable-archive-bytes","history-archive-storage-host-picker"]
- time: "2026-08-09T16:05:18.071Z"
  kind: "evidence"
  summary: "User direction, 2026-08-09: offer Otto-only and provider cleanup scopes, report only bytes deleted by the selected scope, and preserve CLI/ACP safety."
- time: "2026-08-09T16:20:26.258Z"
  kind: "note"
  summary: "Implemented additive cleanup scope protocol, archive-time manifest persistence, conservative provider adapter contract with unsupported ACP/remote default, provider-safe deletion ordering, separate byte accounting, capability gating, archived-row size projection, scope UI, translations, docs, and targeted tests. Delivery remains partial because no direct provider adapter is registered without a provider-approved deletion API; those providers are intentionally unsupported."
  affects: ["provider-aware-archive-cleanup"]
