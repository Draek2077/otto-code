---
id: "orchestration-observability-and-accounting-design"
kind: "architecture"
title: "Orchestration observability and accounting (design)"
status: "proposed"
tags: ["orchestration", "observability", "accounting", "per-node-record", "archdocs-retirement"]
created_at: "2026-08-16T13:28:53.871Z"
updated_at: "2026-08-16T13:28:53.871Z"
---

# Orchestration observability and accounting (design)

<!-- compiled_truth -->

A graph you cannot inspect is a slot machine. Every visual builder surveyed ships a per-node execution log with inputs and outputs; it is the feature that turns "this graph is bad" into "this node's prompt is bad". Status: the transport half is built — the engine persists and pushes the full `Run` on every change (`runs.updated.notification`), phases carry statuses, skip reasons, candidates with summaries and output fields, retry counts and `timedOut`, so a client can already paint per-node state from its replica with no new event types. What is NOT built: the per-node measurement record (timings, tokens, cost, tool calls) — now decided and promoted to a precondition of the template initiative (the per-node-accounting decision) — and the run estimate/budget events. The event names below are design vocabulary for what the snapshot push must come to carry, not a proposed side channel.

The event stream: the daemon already emits a run snapshot on every state change and persists it — the engine mutates a working `Run` and calls a persist-and-broadcast-store path; clients keep a replica fed by pushes rather than polling. Beyond today's phase statuses, the stream needs to carry: node.started (paints the canvas, starts the elapsed timer); node.output (the structured result — summary, artifact refs, declared fields, evidence); node.excluded (with a reason — branch not taken, upstream failed, run canceled; without the reason a greyed node is indistinguishable from a bug); node.progress (optional, throttled — current tool, tokens so far; what makes a long node feel alive rather than hung); run.paused (a gate is waiting, drives the notification and approve affordance); run.budget (spend against the ceiling, so the user can stop a run before it stops itself). Throttling is a requirement, not an optimisation: six concurrent agents streaming into a phone over a relay will saturate transport, render loop and battery. Rivet throttles per-node partial output to ~100ms; that is the right order of magnitude.

The per-node record: `RunPhaseCandidate` already carries `agentId`, `personalityId` and `summary`. What makes a graph tunable is the rest: startedAt/completedAt (where the wall-clock actually went), tokens/cost (per node, rolled up from the child agent's own accounting), filesTouched (the write-isolation story, the honest answer to "what did this thing do to my repo"), output (the structured result, which doubles as what resume reads), attempt (which loop iteration this was, so a retry ladder is legible).

Accounting — the part that came free and must stay free: every node is an ordinary Otto agent, parented to the orchestrator, so activity stats, the usage ledger, per-personality stats and the sub-agent roll-up all work with no orchestration-specific plumbing. The rules from the audit architecture apply unchanged: no inflation (a child's tokens are counted once, the parent's residual is de-inflated so a run's total is not the sum of double-counted parts); cost is derived from tokens and a model's price, never reported independently; local-only (nothing leaves the machine). The one orchestration-specific addition is a run total — what this orchestration cost end to end, visible on the run and next to the estimate shown before it started. At an order-of-magnitude premium over a chat, estimate-versus-actual is the number that decides whether a user trusts the feature twice.

Live canvas: covered by the designer record; the point here is it needs no new transport — the daemon emits, the client subscribes, the canvas paints. One lesson from Rivet's protocol worth not copying: its frames are asymmetric ({type,data} inbound, {message,data} outbound) with no versioning. Otto's RPC namespacing and compatibility rules already prevent that class of problem — keep orchestration events inside them rather than inventing a side channel.

Visualizer: an orchestration is a parent agent with children, which is exactly what the Visualizer already renders — no orchestration-specific work is required to show a run. The open question is whether a graph's drawn topology should override the Visualizer's force layout for orchestration runs; that is a genuine product choice, not a technical constraint, and is deferred.

What "good" looks like: after a run and without reading the chat, a user should be able to answer — which node was slow, and which node was expensive; which nodes ran in parallel, and which waited on which; why a node did not run; what each node actually produced, as an artifact they can open; whether the estimate was honest. If any of those needs a transcript read, the observability layer is incomplete.

Invariants: every excluded node carries a machine-readable reason, and the UI shows it; node cost is counted once, run totals never double-count children; cost is always derived, never independently reported; streaming to clients is throttled and bounded; orchestration events live inside the existing RPC namespacing and compatibility rules; accounting requires no orchestration-specific plumbing (if it ever does, the node has stopped being an ordinary agent and that is the bug).

## Timeline

- time: "2026-08-16T13:28:53.871Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-per-node-accounting-is-a-precondition","orchestration-designer-and-authoring-surface-design","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T13:28:53.871Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 18-orchestration-observability. Status proposed: the per-node measurement record and estimate/budget events are design (the per-node record is the promoted precondition in the [[orchestration-per-node-accounting-is-a-precondition]] decision). The accounting rules reference the audit architecture, now in docs/subagent-accounting.md and docs/activity-stats.md. Where the built transport half and the code disagree, code wins."
