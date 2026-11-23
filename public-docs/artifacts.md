---
title: Artifacts
description: Create, keep, update, and recover durable HTML deliverables in Otto.
nav: Overview
order: 24
category: Artifacts
---

# Artifacts

Artifacts are durable, self-contained HTML deliverables that belong to one project on one Otto host. They can be reports, dashboards, visual tools or other interactive documents.

Open **Artifacts** in the sidebar, choose a project and select **New artifact**. You can also open Artifacts from a workspace's context menu or Command Center, or ask an agent in chat to create one. Generation runs on the selected daemon host, so you can leave the page and return later.

Choose a provider/model or use the host's configured generation selection. Otto creates a fresh provider session, requests structured HTML and denies any interactive permission requests. It does not resume your chat. Native provider startup settings keep their normal behavior; this is not a separate isolated environment for running untrusted provider customizations.

The CLI connects to the same selected daemon:

```bash
otto artifact create --workspace <workspace-id> \
  --name "Release report" \
  --description "A self-contained interactive release-readiness report."
```

## Find and open artifacts

The library lists artifacts from registered projects on the selected host. Search names and descriptions, or choose a project to narrow the list. Stars put your preferred artifacts first.

Select **Open artifact** to preview it. The wide layout keeps the list beside the content; compact screens stack them. Previewing does not change the stored document. **Copy HTML** and **Export HTML** bring a copy to your device without publishing it.

Each card identifies its project, storage location and current state. The selected artifact shows its owning host path, errors, source, generation log and recent runs. A Chat source can reopen the original chat when it still exists.

## Choose where artifacts live

Artifacts have their own storage setting. It does not follow the setting for Knowledge, Schedules, or Workflows.

- **Repository** stores artifacts in `<project>/.otto/artifacts`, so the project can share them through its normal repository workflow.
- **Selected daemon host** stores artifacts under Otto Home on that host. They are durable for that project on that host, but are not synced to another host.

Choose a default in Artifacts settings, then override it in Project Settings. An existing repository store keeps its location when the project inherits the default. Changing a preference never silently moves or hides existing artifacts.

Use **Move to host** or **Move to repository** on a settled artifact to transfer its output, metadata, recovery snapshot and run history within the same project. The destination must be empty. Legacy host-global records remain visible until you explicitly choose a destination. Otto does not move artifacts between projects or synchronize them across hosts.

## Update data without redesigning it

Generated artifacts are asked to include an `otto-artifact-data` JSON contract. When present, **Update data only** replaces that block while preserving every byte outside it. Use this for a dashboard whose numbers changed but whose design should stay fixed.

Older artifacts without a data contract cannot use this update path. Regenerate them to create a new design and data contract instead.

Agent tools can inspect and update the data contract. The CLI accepts a local JSON file and the revision returned by inspection:

```bash
otto artifact ls --workspace <workspace-id>
otto artifact inspect <id> --workspace <workspace-id>
otto artifact data <id> --workspace <workspace-id> --revision <revision> --input data.json
```

## Regenerate, cancel, and repair

Use **Regenerate design** when you want a new visual output. It may change the design and requires confirmation. It is separate from a data update.

If generation fails, times out or is canceled, Otto retains the previous good output and shows a recoverable error. Cancel asks the owned provider session to stop and blocks late publication. It cannot guarantee how a provider bills an already accepted request.

Visible pages refresh external file changes. Missing or invalid HTML disables preview and leaves the external file intact. **Repair** restores a valid recovery snapshot after confirmation and retains the damaged bytes. Local edits stay in their draft after a conflict or uncertain write; **Reload saved output** explicitly replaces that draft with the saved version.

Run `otto artifact --help` for lifecycle commands. Revision-pinned destructive actions also require `--yes`:

```bash
otto artifact regenerate <id> --workspace <workspace-id> --revision <revision> --instruction "New design" --yes
otto artifact cancel <id> --workspace <workspace-id> --revision <revision>
otto artifact repair <id> --workspace <workspace-id> --revision <revision> --yes
otto artifact move <id> --workspace <workspace-id> --revision <revision> --destination repository --yes
```

## Current limits

- Artifacts are HTML only and must be self-contained.
- Preview permits inline interaction and blocks network resources, external frames, forms, popups and host access. Device WebView and native-provider runtime evidence remain separate from browser and package-build checks.
- Otto does not publish artifacts to the web or synchronize host-local artifacts across hosts.
- Artifact provenance records the latest known source, not a source history.
- Workflow sources and existing-agent Schedule sources are not available yet.
- An abandoned write lock requires explicit verification that all writers have stopped. Locks never expire just because they are old.
