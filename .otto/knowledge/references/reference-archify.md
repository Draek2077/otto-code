---
id: "reference-archify"
kind: "reference"
title: "Archify"
status: "proposed"
tags: ["architecture","diagrams","documentation","vendor"]
reference_disposition: "read"
source_url: "https://github.com/tt-a1i/archify"
created_at: "2026-08-27T19:15:48.882Z"
updated_at: "2026-08-27T19:15:48.882Z"
---
# Archify

<!-- compiled_truth -->

# Archify

Archify is a Node.js diagram-as-code renderer for architecture, workflow, sequence, data-flow, and lifecycle documents. An agent authors typed JSON IR; Archify validates the source and produces a self-contained interactive HTML/SVG deliverable. The viewer supports reader interaction such as theme switching, pan/zoom, search/focus, authored reach and route tracing, curated views, presentation, and export.

## Project evaluation

Archify is a strong renderer and validation engine for Otto's proposed Knowledge-linked visual documents. It does **not** replace Project Knowledge: canonical architecture truth, evidence, and review lifecycle remain in Otto-owned Markdown. A diagram is a revisioned visual document derived from explicitly declared Knowledge and code sources.

Its MIT license permits vendoring and modification in Otto provided its copyright and license notices remain. The original Cocoon AI copyright notice is also retained by upstream and must remain in distributed copies. This is license compatibility assessment, not legal advice.

Use the renderer through an Otto-owned adapter and keep the vendor tree separate from Otto code. Do not expose its local opener, preview server, or Chrome-launching visual-check command as daemon capabilities. Do not ship its upstream brand-mark catalogue by default: its Simple Icons collection work is CC0, but product names and logos may remain subject to trademark rules.

The current upstream version is a development build. Vendor a pinned subtree commit and update deliberately, with an `OTTO-PATCHES.md` record for any carried changes.

## Timeline

- time: "2026-08-27T19:15:48.882Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["architecture-visual-documents"]
- time: "2026-08-27T19:15:48.882Z"
  kind: "evidence"
  summary: "Reviewed the upstream repository, README, SKILL.md, LICENSE, and pinned checkout 9a5060566c832832fb843e457e58c8ee6bac82fd on 2026-08-27. The package declares MIT; its current runtime renderer is Node ESM and its published architecture/workflow/sequence/dataflow/lifecycle outputs are self-contained interactive HTML with inline SVG. Brand marks carry a separate trademark-use caveat."
