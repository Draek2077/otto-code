---
id: "reference-archify"
kind: "reference"
title: "Archify"
status: "confirmed"
tags: ["architecture","diagrams","documentation","vendor"]
reference_disposition: "dependency"
source_url: "https://github.com/tt-a1i/archify"
created_at: "2026-08-27T19:15:48.882Z"
updated_at: "2026-09-26T21:39:55.415Z"
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
- time: "2026-08-29T20:01:18.474Z"
  kind: "note"
  summary: "The pinned MIT upstream renderer is now vendored and invoked only through Otto's daemon-owned Architectural Views adapter; upstream remains an implementation dependency, not the product-facing name."
  affects: ["reference-archify"]
- time: "2026-09-13T04:53:37.018Z"
  kind: "note"
  summary: "Status changed through Otto project knowledge review. New status: confirmed."
- time: "2026-09-26T17:07:55.757Z"
  kind: "evidence"
  summary: "Upstream delta review, 2026-09-26: main (9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993) is 90 commits past the vendored pin 9a5060566, and about 25 of them touch the shipped runtime. High-value changes: 10722002b embeds the viewer font and removes the Google Fonts links, and d673e8300 stops large renderer receipts being truncated on a pipe. Also dataflow/sequence/viewer fixes, stricter CLI argument checks, a workflow constraint compiler with schema_version 2 (additive), and bb71ccdd6, which splits the viewer source into viewer/*.js modules and still commits the generated template.html. The schema changes are additive, but the new workflow column-capacity and sequence label-containment checks can reject specs the pin accepted, so stored Views need a re-render smoke test. The window.Archify API and the theme/preset CSS are unchanged. Recommendation: re-pin to main at that SHA, not v2.16.0, which predates both high-value fixes. The in-repo vendor copy matched upstream byte-for-byte apart from line endings (a plain copy, not a git subtree). The re-pin itself is awaiting the user, because agent tooling was not permitted to import upstream code."
  source: "gh api compare 9a5060566...main, 2026-09-26"
- time: "2026-09-26T21:39:55.415Z"
  kind: "evidence"
  summary: "Re-pinned 2026-09-26 from 9a5060566 to upstream main 9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993 as a plain tree copy (git archive), recorded in vendor/archify/OTTO-PATCHES.md. Still no in-vendor patches. The stored architecture View re-rendered with 9/9 checks passing, and the server Archify renderer and Interactive Views service tests passed (12). The Otto presentation bridge was verified against the new viewer in the agent-lane app: toolbar and status bar, diagram text in the user's mono font, and a PNG export. The SVG export's root font is the Otto mono stack with its face embedded. All six embedded JetBrains Mono @font-face rules are removed; only upstream's font attribution comment remains."
  source: "Verified 2026-09-26"
  affects: ["architecture-visual-documents"]
