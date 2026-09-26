# Otto patches

This is a stock copy of [tt-a1i/archify](https://github.com/tt-a1i/archify) at
`9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993` (main, 2026-09-23; `2.17.0-dev.1`, past `v2.16.0`).
It is a plain tree copy, not a git subtree: update it by replacing the tree with `git archive` of
the new upstream commit, keeping this file.

No in-vendor patches are carried. Otto's integration lives outside this directory:

- the daemon adapter in `packages/server/src/server/archify/`;
- the presentation bridge (theme, fonts, toolbar commands, export capture) injected by the app,
  documented in `docs/interactive-views.md`. It depends on the viewer's `window.Archify` API, the
  `.toolbar`, `.header`, `.diagram-nav`, and `.diagram-container` markup, the viewer's CSS
  variables, and export serialization through `XMLSerializer`. Check those after every update.

Archify is MIT licensed. Its `LICENSE`, `THIRD_PARTY_NOTICES.md`, and upstream copyright notices
are retained with this copy.

## Update log

- 2026-09-26: `9a5060566` to `9e35d2b0b`. Brings the embedded viewer font, untruncated renderer
  receipts, the workflow constraint compiler (`schema_version` 2, additive), dataflow, sequence,
  and viewer fixes, and stricter CLI argument checks. Smoke render of the stored architecture View
  passed 9/9 checks.
