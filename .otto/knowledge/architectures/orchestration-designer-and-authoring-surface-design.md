---
id: "orchestration-designer-and-authoring-surface-design"
kind: "architecture"
title: "Orchestration designer and authoring surface (design)"
status: "proposed"
tags: ["orchestration", "designer", "canvas", "drawflow", "authoring", "archdocs-retirement"]
created_at: "2026-08-16T13:28:22.714Z"
updated_at: "2026-08-16T13:28:22.714Z"
---

# Orchestration designer and authoring surface (design)

<!-- compiled_truth -->

The graph designer is a workspace tab (web + Electron; native gets a placeholder). It is the only surface where a user expresses structure, so its job is to make the consequences of structure visible — what runs in parallel, what waits, what a human approves, what proves the work. This is the design surface; the shipped authoring behaviour (node cards, Advanced disclosure, one-per-line forms, round-trip carry, drafts, repair-on-load) is documented in `docs/orchestration-node-capabilities.md` §"Authoring these in the designer", which is authoritative for what is built. Multi-port rendering, the control-node palette entries and live run painting are design, pending the matching engine work. The whole surface is dev-only until the designer matures.

Architecture: a vendored, frozen Drawflow bundle (MIT) plus an Otto-owned TypeScript wrapper. None of the vendor's own UI comes along; Otto owns the toolbar, node cards, palette and theme. The bundle is never formatted, linted or edited — `**/vendor/**` is ignore-listed, and the MIT notice lives beside it because the upstream build strips its own banner. The split that matters — canvas here, executor in the daemon — is not an Otto invention; Rivet arrived at the same shape independently (an isomorphic executor decoupled from any database, a WebSocket debugger letting its IDE attach to a processor running elsewhere). That is a strong signal the boundary is in the right place and the argument for the live-run feature below.

Port model in the UI: ports are arrow-shaped, ride outside the card border, and read hollow until wired and solid once connected; output ports carry the accent colour, inputs the warm counter-hue. Multi-port is the change the designer must absorb next (per the ports-and-conditions decision): a gate has approved/rejected, a check has pass/fail, a router has one port per branch. Requirements: every port renders a label (an unlabelled second output is unusable); ports are ordered and stable (a port's vertical position must not move when an unrelated setting changes, or wires appear to jump); dynamic ports (map, subgraph) derive from data (a subgraph node's ports come from the child graph's declared inputs and outputs, recomputed when the child changes).

Connection legality has exactly one implementation: if ports become typed, the same function must answer "may I draw this wire?" and "may I pass this value?". Rivet is the cautionary tale — its editor-side check is advisory styling only, its runtime coercion is separate, and the source carries the comment that the two are hard to keep in sync; the result is that an illegal connection is drawable and fails at runtime, the worst of both worlds.

Easy snap: a 13-pixel port is a miserable drop target and Drawflow only connects on a pixel-perfect release. While a wire is in flight the nearest input inside a radius attaches (it fills and scales, and the wire's loose end jumps to it), and releasing anywhere lands there. Implemented as a capture-phase mouseup that hands Drawflow's own dragEnd a synthetic event whose target is the snapped port.

Node palette, grouped by the three families (also how the Add menu reads): lifecycle (Orchestrator — root, structural, undeletable — and Brief), control (Gate, Router, Map, Merge, Subgraph), capability (Agent, Check). A node card is a title bar (type prefix, inline-editable name, delete), a body with the fields that matter at a glance (role, prompt), and an Advanced disclosure for the machinery (prompt-from-input, model override, tool authority, isolation, loop). The principle: a node reads clean until you need the machinery. Declared graph inputs surface inside nodes — a hint line listing the `{{inputs.key}}` references available, and a prompt-from-input select over the declared keys, both refreshed live as the Inputs sheet changes.

Validation feedback, two levels (conflating them is a UX failure already made once): save is never blocked (a half-built graph is a normal thing to save; save failure — the host rejected the write — is the only red); validation gates execution only, reported as a warning with the count and the first blocker named, not as an error implying the work was lost. Run saves first, then opens the New Orchestration dialog with this graph preselected so the user fills in Answers and confirms; the designer never executes directly, which keeps "what am I about to spend" in one place.

Live run painting (target): the daemon already emits run events and the client already subscribes; wiring them to the canvas turns the designer into the run monitor. Node visual states, borrowing Rivet's vocabulary: running (accent pulse, elapsed timer, current tool if reported), ok (solid, output summary on the card), error (danger border, message on the card), notRan/excluded (greyed, with the reason — "branch not taken", "upstream failed", "run canceled"), paused (the gate node highlighted, approve/answer affordance inline). Carrying the reason on an excluded node is what makes a conditional graph debuggable; without it a greyed node is indistinguishable from a bug. Throttle partial output — Rivet throttles per-node partial outputs to ~100ms; a graph with six concurrent agents streaming tokens into a canvas will otherwise saturate the transport and the render loop and, on a phone, the battery.

Drafts: the tab unmounts on every workspace switch, and a graph is a document — leaving the room is not discarding. A session-scoped working copy is held per host and graph, so returning finds the canvas exactly as it was, still marked unsaved; nothing reaches the host until the user saves.

Repair on load: graphs outlive schema changes. When a stored graph references a port that no longer exists on a node kind, the loader drops that connection and continues rather than refusing to open the graph — the same defensive behaviour Rivet applies when it snapshots port definitions at preprocess time. A graph that cannot be opened cannot be repaired by the user; one that opens with a missing wire can.

Compact devices: the dialog and the execute/monitor flow are cross-platform and the priority — starting an orchestration, watching it, and approving a gate must all work from a phone (approving a plan from anywhere is one of the strongest arguments for the feature). Authoring is desktop-shaped; native shows a placeholder pointing at the desktop. A mobile designer remains a stretch goal, never a commitment.

Invariants: the vendored canvas bundle is never edited, formatted or linted; the orchestrator root is undeletable and restored immediately if removed; saving is never blocked by validation, only execution is; every port has a visible label and port order is stable across unrelated edits; if ports are typed, one function decides legality for both editor and engine; an excluded node always paints its reason; streaming into the canvas is throttled; unsaved edits survive in-app navigation.

## Timeline

- time: "2026-08-16T13:28:22.714Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["ports-and-conditions-are-not-competitors","orchestration-node-capabilities","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T13:28:22.714Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 17-orchestration-designer. Status proposed: most of this surface (multi-port rendering, control-node palette, live run painting, compact story) is design, pending the matching engine work; the shipped authoring behaviour lives in docs/orchestration-node-capabilities.md. Where the built parts and the code disagree, code wins."
