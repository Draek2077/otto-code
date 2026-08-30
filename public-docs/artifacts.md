---
title: Artifacts
description: Create, keep, update, and recover durable HTML deliverables in Otto.
nav: Overview
order: 24
category: Artifacts
---

# Artifacts

Artifacts are an in-progress 0.9 surface for durable, self-contained HTML deliverables that an Otto agent creates for a project. The implementation has deterministic daemon and unit coverage, but its browser journey, live Electron desktop path, CLI round trip, and live-provider generation have not yet been release-validated. Treat the behavior below as the current implementation contract, not a completed release promise.

Create one from the **Artifacts** view, or ask an agent in chat to create one. Otto runs generation as a background agent job with your selected provider and model. You can leave Otto while it runs, then return to the artifact library later.

The current implementation runs background generation unattended. If the requested permission mode could prompt, Otto replaces it with that provider's unattended default so the job does not wait for someone to approve a tool call. Deterministic service coverage exercises the deny-by-default path for Claude and OpenAI-compatible providers, but no live-provider Artifact run has been recorded. Other provider adapters can start artifact jobs, but they do not yet have the same deterministic guardrail coverage.

An explicitly selected mode that the provider marks as unattended is kept. That includes **Bypass** where the provider offers it. Do not select Bypass for an unattended artifact if you need Otto's deny-by-default protection.

The CLI commands are implemented, but their real daemon round trip is not yet release-validated:

```bash
otto artifact create "Release report" \
  --project ~/dev/my-app \
  --provider codex \
  --description "A self-contained interactive release-readiness report."
```

## Find and open artifacts

The Artifacts library lists all artifacts available on the selected host. Search by name, description, project, storage location, source, or status. Filter it to one project when you need a narrower view.

Select an artifact to preview it, or open it in an Otto workspace tab. Opening and previewing are intended to be read-only. Choose an explicit update or regeneration action when you want to change it.

Each card shows its project, storage location, current state, last update, and available source information. A Chat source can reopen the original chat. A new-agent Schedule source identifies its schedule run, although it does not yet have a direct Schedule link.

## Choose where artifacts live

Artifacts have their own storage setting. It does not follow the setting for Knowledge, Schedules, or Workflows.

- **Repository** stores artifacts in `<project>/.otto/artifacts`, so the project can share them through its normal repository workflow.
- **This host** stores artifacts under Otto Home on the selected daemon host. They are durable for that project on that host, but they are not synced to another host.

Choose a default in Host Settings, then override it for an individual project in Project Settings. Changing either setting affects new artifacts only. It never silently moves existing artifacts.

An existing settled artifact can be moved explicitly between **Repository** and **This host**. Otto moves its metadata, HTML, last-good recovery snapshot, and retained run history together. Legacy artifacts remain visible as **Legacy location** until you choose a destination. Otto does not publish artifacts externally, copy them between projects, or synchronize them across hosts.

## Update data without redesigning it

Generated artifacts include a declared JSON data contract. Use **Update data** in the artifact card to replace that data while preserving the artifact's HTML, CSS, and JavaScript exactly as they are. This is the right action for a dashboard whose numbers or rows changed but whose design should stay fixed.

Older artifacts without a data contract cannot use this update path. Regenerate them to create a new design and data contract instead.

The following data commands are implemented but share the outstanding CLI end-to-end validation:

```bash
otto artifact ls
otto artifact data <id>
otto artifact update-data <id> --data '{"visits":42}'
```

## Regenerate, cancel, and repair

Regeneration is always explicit. Use **Regenerate** when you want Otto to create a new visual output from the stored artifact definition. It is different from a data update and may change the design.

If generation fails, times out, or is cancelled during a regeneration, Otto retains the previous good output and shows a recoverable error. You can regenerate again or cancel an in-progress run from the library.

Otto also watches ready artifacts for external file changes. A valid edit refreshes the artifact. If an external HTML edit is missing or invalid, Otto preserves that file for inspection, blocks unsafe preview, and keeps a last-known-good copy. Use **Repair** to restore that copy. Otto never silently overwrites an invalid external edit.

The same lifecycle commands are implemented in the CLI, pending end-to-end validation:

```bash
otto artifact regenerate <id>
otto artifact cancel <id>
otto artifact repair <id>
otto artifact move <id> --to repository
```

## Current limits

- Artifacts are HTML only and must be self-contained.
- The intended preview security boundary permits artifact-local interaction while blocking popups, network access, navigation, and host access. The browser proof has not been executed in the audited evidence, and Electron and native platform proof are also open. Do not rely on Artifacts to contain untrusted content until those platform validations are complete.
- Otto does not publish artifacts to the web or synchronize host-local artifacts across hosts.
- Artifact provenance records the latest known source, not a source history.
- Workflow sources and existing-agent Schedule sources are not available yet.
- A Schedule source currently identifies the run but cannot open the Schedule directly.
