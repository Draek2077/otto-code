---
id: "workflow-attempt-isolation"
kind: "project"
title: "Workflow attempt isolation"
status: "proposed"
tags: ["workflows","ai-orchestration","graph-execution","worktrees","safety"]
delivery_status: "charter"
created_at: "2026-10-08T02:01:06.491Z"
updated_at: "2026-10-08T02:01:06.491Z"
---
# Workflow attempt isolation

<!-- compiled_truth -->

# Workflow attempt isolation

Part of [[workflows]].

## Problem

Every chat a Workflow spawns works in the conductor's checkout (`resolveScopedCwd(undefined)` in `register-orchestration-tools.ts`), and nothing reverts a failed attempt. For work that edits files, that makes three shapes unsafe:

- **Replacement.** A bounded phase with `keepBest` replaces a failed candidate with a fresh agent, which starts over on files the failed attempt already changed and cannot tell its baseline from the leftovers.
- **Fan-out.** `fanOut > 1` runs several agents editing the same files at once, so "keep the best" cannot discard the losers: they all wrote into one tree.
- **Graph retry.** `retry.maxAttempts > 1` re-runs a node's whole prompt after an attempt that errored or timed out, often mid-edit.

As of 2026-10-07 these are refused for editing work before anything spawns (`describeUnsafeEditingPhase`, `validateGraphNodeRetry`; see `docs/workflows.md`, "Work that edits files is never redone"). Editing work may only be fixed forward: one candidate, continued in its own chat. That guard is the floor this project lifts.

## Outcome

Fan-out, replacement and retry become safe, and useful, for work that edits files, because **each attempt runs in its own git worktree** and only the chosen attempt's changes ever reach the workspace.

- Every candidate of an editing phase, every replacement, and every Graph retry attempt gets a fresh worktree branched from the same base commit (the phase's input state).
- The judge grades that worktree's diff and the candidate's report, not a shared tree.
- The phase's result is the chosen worktree. The next phase builds on it.
- Losing and failed attempts are discarded whole, with their worktree and branch removed, so a failed attempt leaves nothing behind.
- Results land in the user's workspace only through an explicit step: a human gate showing the diff, or an "apply the winner" step the plan declares. The user's own uncommitted work is never reset, stashed or overwritten.

## Scope

- **Engine.** A per-attempt workspace port: create a worktree for an attempt, spawn the candidate there, judge it there, promote the winner, discard the rest. AI plans and Graph Workflows share it.
- **Base state.** Define what an attempt branches from when the workspace has uncommitted changes (snapshot commit on a private ref, never the user's branch) and how a phase passes its chosen state to dependents.
- **Promotion.** How the winning worktree's changes reach the workspace (merge, cherry-pick or patch apply), conflict handling, and what the user sees at the gate.
- **Cleanup.** Worktrees and branches removed on loss, failure, cancel, and daemon-restart recovery; nothing leaks across runs.
- **Projection.** The run record names each attempt's worktree and diff so the Workflow tab can show and open it.
- **Capability gate.** A `server_info.features` flag. With it, the guard relaxes for phases that run isolated; without it, the guard stays as it is.
- **Read access.** Plan phases gain an enforced workspace access level like Graph nodes (`none` / `read` / `write`), replacing the phase-type heuristic in `runPhaseEditsWorkspace`.

## Out of scope

- Reverting arbitrary side effects outside the repository (network calls, external services, databases). Isolation covers the checkout only; work with external side effects stays fix-forward.
- Concurrent distinct editing nodes in one Graph (parallel branches that edit different files). That is a separate coordination question from redoing work.

## Acceptance criteria

1. An editing phase with `fanOut: 3` and a judge runs three candidates in three worktrees, the judge grades each diff, and only the kept candidate's changes appear in the workspace after its gate.
2. A failed attempt's worktree and branch are gone after the phase ends, including after cancel and after a daemon restart.
3. A replacement round starts from the phase's base commit, not from the failed attempt's edits.
4. A Graph write node with retries re-runs each attempt in a fresh worktree.
5. Uncommitted changes in the user's workspace before the run are untouched at every point.
6. On a host without the capability, the 2026-10-07 guard still refuses these shapes with its current message.
7. `docs/workflows.md` documents isolation as the spec, and the guard's section names when it applies.

## Prior art to evaluate

Otto's own worktree support (`create_worktree` / `archive_worktree` tools and the server worktree service), and best-of-N coding agents that run attempts in isolated sandboxes and apply only the chosen diff.

## Timeline

- time: "2026-10-08T02:01:06.491Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["packages-server-src-server-workflow-workflow-engine-ts","packages-server-src-server-workflow-graph-engine-ts","packages-server-src-server-agent-tools-register-orchestration-tools-ts","packages-protocol-src-workflow-ts","docs-workflows-md","docs-workflow-node-capabilities-md"]
- time: "2026-10-08T02:01:06.491Z"
  kind: "evidence"
  summary: "2026-10-07: code read of `register-orchestration-tools.ts` confirmed every Workflow child spawns with the same cwd and no worktree. `workflow-engine.ts` `computeRoundNeed` replaces candidates only when `keepBest` is set; `graph-engine.ts` `dispatchNode` retries by re-running `dispatchNodeAttempt` with a fresh agent and the base prompt. The interim guard (protocol `describeUnsafeEditingPhase` / `validateGraphNodeRetry`, daemon `buildRunFromPlan`) shipped the same day with engine, protocol and integration tests green."
