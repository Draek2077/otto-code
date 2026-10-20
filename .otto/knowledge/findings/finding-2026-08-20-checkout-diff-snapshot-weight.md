---
id: "finding-2026-08-20-checkout-diff-snapshot-weight"
kind: "finding"
title: "The checkout diff snapshot is the app's heaviest wire payload, and the changed-path set rides on it"
status: "proposed"
tags: ["performance","git","protocol","app"]
created_at: "2026-08-21T03:38:55.889Z"
updated_at: "2026-08-21T03:38:55.889Z"
---
# The checkout diff snapshot is the app's heaviest wire payload, and the changed-path set rides on it

<!-- compiled_truth -->

## What was measured

On a synthetic large repository (1,720 directories, 16,105 files, 120 changed files, 14,400 insertions), one `subscribe_checkout_diff_response` frame is **3,643,962 bytes**. That is the full tokenized diff snapshot: per-line syntax-highlight tokens for every changed file, shipped as a single JSON frame. Parsing and storing it blocked the browser main thread for one long task of up to **595 ms**.

## Why this reaches past the Changes tab

The changed-path set (a list of 120 strings, honestly about 4 KB) has no lighter carrier today. `useChangedFilePaths` in `packages/app/src/git/changes-reveal.ts` mounts the same full `useCheckoutDiffQuery` the Changes pane uses, and says so in its own comment: "There is no lighter RPC for it: the daemon serves the diff or nothing."

Two surfaces need only that set and both pay full price:

- `packages/app/src/components/file-explorer-pane.tsx` decides whether a Files-tree row offers "View changes".
- `packages/app/src/components/file-tab-pane.tsx` decides whether the file toolbar offers "View changes".

Checkout status cannot substitute: `CheckoutStatusCommonSchema` carries `isDirty` and `diffStat` totals, never a file list.

## Consequence, now that subscription churn is fixed

Workstream C of [[august-20-ux-feedback-sweep]] removed the repeated cost by lingering the subscription across a sidebar toggle, so a toggle no longer re-pulls the snapshot. That fixes the reported spike but not this: the **first** open of a workspace's explorer still pays 3.6 MB, and so does any reopen after the linger window expires.

This is the same problem as structural item 3 in [[finding-2026-08-02-static-code-audit]] ("full tokenized diff snapshot re-shipped per update, tokens ~2-3x the text"), now with a measured number attached and a second, cheaper consumer identified.

## Directions, none of them chosen yet

1. A dedicated lightweight changed-paths RPC, so the two "View changes" affordances stop mounting the diff at all. New daemon capability, so it needs a `server_info.features` gate.
2. Drop `tokens` from the wire where `content` is present and highlight client-side, or ship per-file revisions instead of whole snapshots.
3. Size-gate the tokenization the way `highlightDiffFromHunks` already gates elsewhere.

## Verified vs hypothesis

**Verified by measurement in the running app over its real WebSocket:** the frame size, the message type, the long-task duration, and that emptying the working tree drops the same toggle's payload to 523 B.

**Not verified:** how size scales beyond 120 files; whether the daemon-side recompute cost is comparable to the wire cost; and which of the three directions above is cheapest to land.

## Timeline

- time: "2026-08-21T03:38:55.889Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["august-20-ux-feedback-sweep"]
- time: "2026-08-21T03:38:55.889Z"
  kind: "evidence"
  summary: "Measured 2026-08-20 against the agent lane (daemon 6799, Expo web 8095) driven through the Otto browser pane, with in-page instrumentation: `WebSocket.prototype.send` patched to capture the live socket, an added `message` listener for inbound frame bytes and types, a rAF frame-gap recorder, and a `PerformanceObserver` on `longtask`.\n\nFixture, reconstructible: a git repo of 40 top-level `service-NN` directories, 6 `module-N` each, 6 `feature-N` each, 10 files per leaf, plus 25 root files (1,720 directories, 16,105 files); then 120 files rewritten to 120 lines each, giving `120 files changed, 14400 insertions(+), 1920 deletions(-)`.\n\nSix open/close cycles on the **Files** tab, Changes tab never opened, 8 folders expanded, 159 rows mounted. Every open received a single frame of 3,643,962-3,644,149 bytes, identified as `subscribe_checkout_diff_response` by parsing the frame in-page. Closes cost 187-374 bytes.\n\nControl, same tree and same expansion, working tree stashed clean: the same open received 523-710 bytes and the worst long task fell from 595 ms to 198 ms - which is what establishes that the payload, not the tree size, was the spike.\n\nCaveat: frame and task timings come from a Metro **dev** bundle (\"Performance optimizations: OFF\"), so absolute milliseconds are inflated relative to a production build; the byte counts are exact and bundle-independent. The lane was shared with another agent session, so timings carry some main-thread noise; six repetitions bound it."
