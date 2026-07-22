# Orchestration Graphs

**Status:** In build (started 2026-07-20)
**Owner surface:** daemon orchestration runtime + Orchestrations page + a new graph-designer workspace tab

**Companion doc:** [orchestration-design.md](orchestration-design.md) — what an orchestration IS, the gap list against real agentic practice, which LangGraph concepts to mirror, and the open-source landscape survey. This file describes what is built; that one describes what is missing and why.

**Execution plan:** [enhancement-plan.md](enhancement-plan.md) — the agreed capability set in Otto vocabulary (skipped results, output fields, `submit_output`, conditional edges, node authority, retry/time limit, prompt templates), staged 0–5 with protocol tables. Supersedes the feature numbering from the external reference spec; the reference implementation review lives in the chat record and `~/Desktop/something/ORCHESTRATION-COMPARISON.md`.

## Mission

Elevate "Orchestration" from a report-with-a-chat into a first-class capability with two flavors:

1. **AI orchestration** (exists today): an agent (or the user, via the new dialog) supplies parameters and a prompt; the conductor declares a phase plan through `start_run` and the daemon runs it. Simple, AI-shaped, non-deterministic in structure.
2. **User orchestration** (this project): a **deterministic graph** authored in a visual node editor. The user decides which roles operate, how many, what each is prompted with, and who receives whose output. The daemon executes the graph exactly as drawn.

Both flavors adhere to the same three principles:

- **Ledger:** every child agent is an ordinary Otto agent — activity stats and token/cost accounting attach with zero new plumbing.
- **Parentage:** children hang off the orchestration's root agent; the Runs/Orchestrations page, subagents track, and Visualizer see the same hierarchy.
- **Monitoring:** an orchestration always lands you in a chat (the root agent's), watchable from any device.

## Naming (glossary-bound)

| Term              | Meaning                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestration** | The user-facing noun for one execution instance — what the wire and code call a `run`. The Orchestrations page lists orchestrations. No user-facing surface ever says "Run". |
| **Graph**         | The reusable template a User orchestration executes. Generic, host-level, parameterized by declared inputs. Executing a graph starts an orchestration.                       |
| `run`             | Wire/CLI/code identifier only (`start_run`, `runs.*`, `run-engine.ts`). Frozen by protocol back-compat; short on purpose.                                                    |

## Decisions (settled with Philippe, 2026-07-20)

1. **Graphs are templates, not jobs.** A graph declares **inputs** (fill-in parameters). Picking an existing graph in the New Orchestration dialog surfaces those inputs as a form; running it mints a fresh orchestration record. Bundled **starter graphs** ship with the software (mirrors the starter team).
2. **Separate engine.** The graph interpreter (`graph-engine.ts`) lives beside the phase engine (`run-engine.ts`), sharing the Run record, store, WS events, and accounting. Phases remain the AI flavor's backbone; the long-term convergence is the AI flavor emitting graphs, at which point phases deprecate. Not v1 work.
3. **Agents never know about waiting.** The daemon holds all barrier state. A node's agent is created/prompted only when every input edge has produced output. From the agent's view: one prompt containing its node prompt plus labeled upstream material.
4. **Loops, both forms, one construct.** A node can carry a loop annotation: `times: N` (fixed repeat) or `until` (bounded retry) with a **judge verdict** as the exit test (existing structured JudgeVerdict machinery) and a hard `max`. Self-grading is not an exit test.
5. **Disparate nodes; the daemon does all linking.** Orchestration participants never call `create_agent`/`send_agent_prompt` to wire themselves together — the daemon creates every node's agent and routes outputs. Tool policy is a clean binary:
   - **Deterministic node:** NO orchestration tools (`start_run`, `create_agent`, `send_agent_prompt`, `cancel_agent`, `archive_agent`, …), NO preview/dev-server tools, NO browser-tab tools, and provider-native subagents/workflows suppressed where the provider allows (Claude `disallowedTools`; per-provider checklist like docs/subagent-accounting.md). They do the work they're prompted with, nothing else.
   - **Autonomous leaf:** full otto tools EXCEPT `start_run` (orchestrations never nest orchestrations). May spawn its own agents/subagents to get its task done; must still be a leaf in the graph (no deterministic children).
   - Enforced **daemon-side at spawn**, not by prompt language.
6. **Nodes carry roles, not personalities.** Resolution at execute time via the existing precedence: active team fills the role → dialog-chosen personality → bare model. Snapshot at execution start (spawn-snapshot lifecycle) so mid-run team edits can't shear a running orchestration. Graphs stay portable across teams and hosts.
7. **Root node = orchestrator = the chat.** Every graph has exactly one root node (the orchestrator). Its agent hosts the orchestration chat and anchors the Visualizer. The daemon routes node completions to it as incoming turns — it activates when information arrives; it does not narrate continuously. Dialog picks the orchestrator source: team's orchestrator role → a personality → a bare model.
8. **Storage is host-level. Always.** Graphs persist in a host-level JSON store (same pattern as personalities/teams): atomic writes, Zod schema, no migrations. Full Otto architecture for everything.

## Data model

### Graph (host-level store, `orchestration-graphs.json`)

```
Graph {
  id, name, description?
  inputs: GraphInput[]        // declared fill-in parameters
  nodes: GraphNode[]
  edges: GraphEdge[]
  createdAt, updatedAt
  builtIn?: boolean           // starter graphs; copy-on-edit
}

GraphInput { key, label, description?, multiline?, required?, defaultValue? }

GraphNode {
  id
  kind: "orchestrator" | "agent"     // exactly one orchestrator (the root)
  title
  role?: string                       // team role to resolve (agent nodes)
  prompt?: string                     // fixed prompt text; may reference {{inputs.key}}
  promptFromInput?: string            // input key whose value becomes/joins the prompt
  autonomous?: boolean                // leaf-only: full otto toolset (minus start_run)
  loop?: { times?: N } | { until: { criteria: string[], judgeRole?, max: N } }
  model?: string                      // optional explicit model override
  position: { x, y }                  // editor layout
}

GraphEdge { id, from: nodeId, to: nodeId }
```

Prompt assembly for a node = its `prompt` (with `{{inputs.*}}` substituted) + the labeled final messages of every upstream node. Fan-in is an **all-inputs barrier**.

**Answers back to the caller:** the root is the entry point — it takes the orchestration's own prompt (and parameters) automatically, so it has an _output_ only and nothing is ever wired into it. It is also structural: the canvas re-adds it instantly if anything deletes it. The graph's **deliverables are its terminal nodes** — whatever no other node consumes is producing for the user, and the wrap-up hands the orchestrator those full outputs to relay (every node's completion still streams to the chat as it happens). Graphs authored while the root briefly had an input port still honour their explicit deliver-back edges; the canvas no longer draws them, and the cycle check still exempts them.

### Run record extension (protocol, wire-compatible)

- `Run.kind?: "phases" | "graph"` (absent = phases; plain-string leaf, open vocabulary).
- `Run.graphId?`, `Run.graphInputs?: Record<string,string>` — what was executed and with which fill-ins.
- `"draft"` joins the run-status vocabulary: record created by the dialog before the graph is chosen/finished; executable later; excluded from "running" filters.
- Graph node states project into the existing `phases[]` array (one phase per node, `type: "graph-node"`) so old clients still render _something_ and the Orchestrations page needs no new list schema.

## Execution semantics

1. Validate: single orchestrator root, DAG over non-loop edges, autonomous ⇒ leaf, all `{{inputs.*}}` declared, roles known.
2. Snapshot role→personality resolution (active team, then dialog fallback).
3. Spawn orchestrator agent (chat home), mark run `running`, navigate the client to the chat.
4. Ready set = nodes whose inputs are all satisfied. For each: build prompt, spawn agent with the node's tool policy, await terminal turn, capture final message.
5. Loop nodes re-dispatch per their annotation; `until` runs the judge between iterations.
6. Node completions route to the orchestrator as turns (labeled). Terminal nodes' outputs always reach it.
7. All nodes terminal → run `done` (or `failed` with the first hard error; cancel cascades like phase runs).

## UI

**Dev builds only, for now.** Every door into this project — the New Orchestration button, the designer tab, running a graph orchestration — is gated on `isDev` (Metro's `__DEV__`) on top of the host capability, in `useOrchestrationGraphsFeature` and `openOrchestrationGraphTab`. Release builds keep the Orchestrations page exactly as it was until the node editor is finished. Drop the `isDev` half when it ships.

### New Orchestration dialog (cross-platform, feature-gated on `features.orchestrationGraphs`)

Top-right button on the Orchestrations page. Creation contract (all required):
**Name**, **Description**, **Project → Workspace** (cascading), **Personality/Model**
(the orchestrator seat), and **Prompt** (AI) / **Answers** (the graph's declared
inputs). Name + Description persist on the Run record (`Run.description`, distinct
from the AI-generated `summary`) and seed a new graph's name/description. Flow:

1. **Flavor:** AI (prompt-and-go) | Graph (deterministic).
2. **Details:** name, description, project → workspace, orchestrator source (team orchestrator → personality → model).
3. AI flavor → prompt box → start (existing `start_run` path, now user-initiated).
4. Graph flavor → **pick existing graph** (its declared inputs render as a form; fill → Run) or **create new** (creates the orchestration as Draft + opens the graph designer tab in the target workspace).
5. Designer's **Save & Use** returns to the dialog with that graph selected and its inputs form showing.
6. Run → daemon executes → client navigates to the workspace chat (root agent).

### Graph designer (workspace tab; web + Electron)

Familiar tab shape: toolbar at top, separator, scroll region with modern scrollbars, canvas inside. Node palette = orchestrator + role nodes; node cards expose title, role, prompt, input bindings, autonomous flag, loop settings. Mobile: the dialog + execute flow works everywhere; the designer itself is desktop-shaped (native gets a "open on desktop" placeholder; a mobile designer is a stretch goal, not a commitment).

## Editor port (from Draekz Forge)

Source: `~/Projects/comfyui-draekz-forge` — **Drawflow** (`app/frontend/vendor/drawflow.min.js`, MIT, dependency-free, DOM-based) + ~2k lines of wrapper (`app/frontend/js/orchestration/orch-canvas.js` et al.).

- Vendor `drawflow.min.js` verbatim (frozen, patched-around — same treatment Forge gives it; `**/vendor/**` is oxfmt-ignored so the bundle stays byte-identical). The upstream build strips its own license banner, so MIT's notice requirement is met by `vendor/LICENSE-drawflow.txt` sitting beside it — same spirit as `vendor/agent-flow/OTTO-PATCHES.md`.
- Port the wrapper patterns to a TS module: orthogonal rounded-elbow wiring (`createCurvature` override), cursor-anchored wheel zoom, selection handling, `draggable_inputs=false`.
- The dotted grid belongs to the canvas content, not the viewport: Drawflow transforms the precanvas instead of painting a background, so the wrapper mirrors its translate + zoom onto the host element's `background-position`/`background-size` (`syncGrid`, driven by Drawflow's `translate`/`zoom` events). Without it the nodes visibly slide off their own grid when you pan.
- **Easy snap:** a 13px port is a miserable drop target, and Drawflow only connects on a pixel-perfect release. While a wire is in flight the nearest input inside `SNAP_RADIUS` attaches — it fills and scales, the wire's loose end jumps to it — and releasing anywhere lands there. Implemented as a capture-phase `mouseup` that hands Drawflow's own `dragEnd` a synthetic event whose target is the snapped port (its listener is on the same element in the bubble phase, so stopping propagation there is what makes it stick).
- **Toolbar (Otto's, not Forge's):** one compact row — graph name and an unsaved marker on the left, icon-only actions (add node, inputs, save, run) with tooltips on the right. Save outcomes are toasts, never toolbar text: success, a warning listing the count and first blocker, or an error when the save itself failed.
- **Unsaved edits survive navigation.** The tab unmounts on every workspace switch, and a graph is a document — leaving the room isn't discarding. `graph-draft-store.ts` keeps the working copy per host + graph for the app's lifetime; nothing reaches the host until the user saves, and a reload finds the canvas as it was, still marked unsaved.
- Port the node design language from `14-orchestration.css`: inner card with title bar ("Agent · <editable name>" + soft-red masked trash), body + Advanced `<details>` disclosure, **arrow-shaped ports riding outside the card border** (output = accent, input = the warm counter hue; hollow until wired, solid once connected — class-managed from Drawflow's export), 3px accent elbow wires, themed round delete bubble.
- Declared inputs surface inside nodes: a `{{inputs.key}}` hint line under the prompt and a "Prompt from input" select over the declared keys, both refreshed live when the Inputs sheet changes (`setDeclaredInputs`).
- Re-skin with Otto theme tokens. None of Forge's surrounding UI comes along — Otto owns the toolbar and buttons.
- A half-built graph always saves; validation only gates Run, and reports as a toast.
- Integration follows the CM6/Visualizer vendoring precedent: `.web.tsx` component wrapping a DOM container ref; native fallback placeholder.
- Rejected alternative: React Flow (`@xyflow/react`) — maintained and React-idiomatic, but re-solves UX problems (wiring feel, type gates, zoom/pan) the Forge wrapper already solved, and loses the exact look we want.

## Milestones

1. **Protocol** — graph schemas, run-kind extension, `orchestration.graph.*` RPCs, `features.orchestrationGraphs`.
2. **Daemon store** — host-level graph store + starter graph seed.
3. **Daemon engine** — graph interpreter + tool policy enforcement + orchestrator routing.
4. **RPC + client** — wire handlers, typed client methods.
5. **App dialog** — New Orchestration flow (both flavors), inputs form, navigation.
6. **App designer** — Drawflow vendoring, designer tab, Save & Use.
7. **Docs** — glossary entries, docs/orchestration.md fold-in when shipped; delete this folder.

## Out of scope (v1)

- AI flavor emitting graphs (convergence path only).
- Cycles beyond the loop annotation.
- Per-node preview/browser opt-in (`allowPreview`) — deliberately off pending a proven need.
- Mobile graph designer (stretch).
- GitLab-style per-provider native-subagent suppression beyond Claude (checklist item per provider).
