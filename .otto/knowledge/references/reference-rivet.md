---
id: "reference-rivet"
kind: "reference"
title: "Rivet"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "read"
source_url: "https://github.com/Ironclad/rivet"
created_at: "2026-08-08T06:18:06.471Z"
updated_at: "2026-08-08T06:19:55.945Z"
---

# Rivet

<!-- compiled_truth -->

**Read, not linked** | The closest working model of Otto's exact architecture, and the one project here both agent-shaped and legally borrowable. **Taken:** the executor/canvas split, **named typed ports** (`{outputNodeId, outputId, inputNodeId, inputId}` - the sequencing insight that had to land before any control-flow node), the `control-flow-excluded` poison value propagating through untaken branches plus explicit `Coalesce` fan-in, and its node-palette vocabulary. **Rejected as a dependency** because it has _no durable persistence at all_ - `pause()`/`resume()` are in-process promises, so if the host dies the run dies - and no notion of agent identity, repo, or authority.

## Timeline

- time: "2026-08-08T06:18:06.471Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:06.471Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 301). Legacy status: MIT."
- time: "2026-08-08T06:19:55.945Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
