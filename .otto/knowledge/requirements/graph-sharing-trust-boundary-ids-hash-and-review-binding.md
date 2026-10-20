---
id: "graph-sharing-trust-boundary-ids-hash-and-review-binding"
kind: "requirement"
title: "Graph sharing trust boundary: safe ids, self-attested hashes, review bound to content"
status: "confirmed"
tags: ["workflows","security","graph-sharing","protocol"]
created_at: "2026-08-30T00:46:26.407Z"
updated_at: "2026-08-30T00:46:26.407Z"
---
# Graph sharing trust boundary: safe ids, self-attested hashes, review bound to content

<!-- compiled_truth -->

Imported Graph packages are untrusted input. Three rules hold at the daemon boundary. (1) A Graph id must be a single file-name segment (`isSafeGraphId`, letters, digits, `.`, `-`, `_`, max 128); `validateOrchestrationGraph` rejects others and `GraphStore` refuses to build a path from one, so an imported id can never leave its store directory or shadow another store's file. (2) A package `contentHash` is integrity only (detects tamper in transit); it is computed by whoever produced the package and is never authenticity or an authority grant. The trust step is the explicit review-then-confirm import, enforced daemon-side. (3) A Workflow start confirmation token is bound to the exact reviewed Graph document (`graphHash`) as well as the launch inputs; editing the Graph between review and confirmed start invalidates the token. Per-session tokens are capped at 16. One canonical hash (`graph-identity.ts`) serves sharing, schedule fingerprints and start confirmation so they cannot drift.

## Timeline

- time: "2026-08-30T00:46:26.407Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows","graph-templates"]
- time: "2026-08-30T00:46:26.407Z"
  kind: "evidence"
  summary: "Decided 2026-08-29 from a code review of the closing Workflows change set. Code: packages/protocol/src/orchestration.ts (isSafeGraphId), packages/server/src/server/orchestration/graph-store.ts, graph-identity.ts, graph-sharing-service.ts, packages/server/src/server/session/runs/runs-session.ts (redeemStartConfirmation). Tests: graph-sharing-service.test.ts, workflow-target.test.ts, runs-session.test.ts, graph-store.test.ts green."
