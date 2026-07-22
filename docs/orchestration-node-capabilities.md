# Orchestration node capabilities

What a **Graph** node can declare beyond a prompt, and how the daemon enforces it.
Everything here is opt-in: a node that declares none of it behaves exactly as it did
before these fields existed. See [../projects/orchestration-graphs/enhancement-plan.md](../projects/orchestration-graphs/enhancement-plan.md)
for the staged plan this implements, and `archdocs/pages/10-18` for the architecture.

Engine: `packages/server/src/server/orchestration/graph-engine.ts`, with one module per
concern beside it. Schemas: `packages/protocol/src/orchestration.ts`.

## Node results are three-valued

A node settles **done**, **failed**, or **skipped**. A skip is control flow routing around
a node — an ordinary outcome, never an error — and it always carries a reason:

| `RunPhase.skipReason` | Meaning                                            |
| --------------------- | -------------------------------------------------- |
| `condition`           | An incoming edge's condition chose another branch. |
| `upstream-skipped`    | Everything feeding this node was itself skipped.   |
| `upstream-failed`     | An upstream node failed.                           |
| `canceled`            | The run was canceled before this node dispatched.  |

`notes` carries the same fact as a sentence, which is what the Orchestrations page shows.
The wrap-up message names every skipped node and tells the orchestrator to say so —
**a run must never report success while silently omitting part of the graph.**

A phase written by an older daemon has no `skipReason`; read that as `upstream-failed`,
the only skip that existed then.

## Output fields — the value plane

A node declares the fields it will produce (`GraphNode.output.fields`). Each descriptor is
`{ key, type, description?, required? }` — plain JSON, never a serialized Zod schema,
because the same descriptor has to be three things: wire-safe, renderable as a form, and
compilable to both Zod (validation) and JSON Schema (the tool's input).

`type` is an open vocabulary — `string`, `number`, `boolean`, `array` today. **An unknown
type validates as "anything" rather than failing**, so an old daemon meeting a new type
degrades to accepting the value instead of refusing a graph it could otherwise run.
`required` absent means required.

When a node declares fields:

1. Its task gains a short instruction listing them (`buildOutputInstruction`).
2. Its agent gets a **`submit_output`** tool (below).
3. Its result is validated and persisted to `RunPhaseCandidate.outputFields`.
4. Downstream nodes receive the values as a labelled JSON block _alongside_ the prose —
   the prose still carries reasoning the fields deliberately don't.

Rule: **references, not contents.** Fields carry values and paths; anything large is a
file the next node reads with its own tools.

## `submit_output` — enforcement with in-session self-correction

`packages/server/src/server/orchestration/node-output.ts`

The node's declared fields ride to the spawned agent as a label
(`otto.orchestration-output-fields`), and the per-agent Otto tool catalog registers
`submit_output` for that one agent. **This is why structured output is provider-neutral:**
MCP-capable seats reach the tool through the daemon's MCP server, openai-compat seats
through the daemon-owned tool loop, and local models get the identical contract. No
provider branch exists anywhere in the engine.

Validation failure returns `isError: true` with a precise message, so the model corrects
**within the same session** — one extra turn instead of a re-dispatch.

Two details are load-bearing and easy to undo by accident:

- **The advertised input schema is permissive.** The catalog parses a tool's input before
  the handler runs and _throws_ on failure, so a strict shape would turn the most common
  mistake (a missing field) into a thrown parse error instead of a correctable tool error.
  Every field is advertised as optional; requiredness is enforced in the handler.
- **`submit_output` is registered past the group and policy gates.** Those gates decide
  which Otto _capabilities_ a node may use. This is not a capability — it is the node's
  own deliverable channel, and a deterministic node (the kind most likely to declare
  fields) would otherwise have it stripped with the `agents` group.

**Harvest order** on settle: the tool call, then a JSON object recovered from the final
message, then failure. The prose fallback exists because small local models often write
correct JSON instead of calling the tool, and discarding that work would be the wrong kind
of strict. A node that declares fields and delivers neither fails, naming the contract.

## Conditional edges

`packages/server/src/server/orchestration/edge-conditions.ts`

`GraphEdge.when.expression` is a JSONata expression evaluated against the upstream node's
output fields (plus `output`, its prose) once it settles. JSONata rather than a bespoke
DSL because it is parsed and evaluated, never `eval`'d — **a graph is user-authored data
and must never become code the daemon executes.**

`GraphEdge.fields` narrows what an edge carries. Selection only, never renaming.

The gating rule, and why it makes diamonds work:

> A drawn edge is a requirement. A node runs when **at least one edge delivers and none
> was ruled out by its own condition.** An upstream that was _skipped_ contributes nothing
> and vetoes nothing.

That distinction is the whole feature. A join below two conditional branches still runs
off whichever branch executed, because the pruned side reaches it as _upstream-skipped_
rather than as a veto. The `starter-triage` graph is the shipped example.

**Otto's scheduler needs no fixed-point pass.** Each node decides after awaiting all of its
upstream promises, so nothing it read can still change — the memoised-promise model
carries conditional edges unchanged.

A condition that throws **fails the node**; it is never treated as a quiet false. A typo
would otherwise silently prune half the graph. Expression syntax is checked before the run
starts (`validateEdgeConditions`, daemon-side — the shared validator stays parser-free for
the client bundle); `reviewOrchestrationGraph` returns the advisory warning when a
condition targets a node with no declared fields.

## Node authority

Three narrowings, all applied at spawn and never requested in prose. Workspace access has
its own section below; the other two:

**Otto tool groups** (`GraphNode.tools`) — an allowlist over the eight existing groups,
read from a label and **intersected** with the daemon-wide allowlist. A node can hand
itself less authority than the daemon allows, never more. An empty array is meaningful
("no Otto tools at all"). This is a cost lever as much as a safety one: the catalog is
paid for in input tokens on every request, and a smaller catalog measurably helps smaller
models stay on task.

**Query tools** (`GraphNode.queryTools`) — author-defined read-only lookups scoped to one
node's session (`node-query-tools.ts`), namespaced `query_*` so they can never shadow a
built-in. Three kinds, each read-only _by construction_ rather than by validation:

| Kind        | Safety property                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`   | argv array spawned with `shell: false`. A parameter containing `;`, `&&`, `$()` is one argument — there is no string to inject into. Pipelines belong in a script the tool points at. |
| `http-get`  | GET only, no author-supplied headers, http(s) only. A graph template cannot carry a credential outbound.                                                                              |
| `file-read` | Path resolved, then checked against the run's cwd. Escapes are refused, not clipped.                                                                                                  |

## Workspace access

`GraphNode.access` — `none`, `read` or `write` (absent means `write`, today's behaviour).
It rides to the agent on `AgentSessionConfig.workspaceAccess`, and each provider adapter
narrows its own tool surface. The meaning of each level lives in one place
(`agent/workspace-access.ts`); how it is imposed is per adapter.

**It is a boundary, not an instruction.** A level is enforced by withholding tools, never
by prose. An agent that was never given a write tool cannot be argued into writing, and a
prompt injection in a file it reads cannot reach for a tool that does not exist.

| Provider                                   | How it is imposed                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **openai-compat** (including local models) | Total: the daemon owns the tool loop, so `availableToolSpecs` withholds the forbidden specs and the model is never told they exist.                                         |
| **Claude**                                 | `applyWorkspaceAccess` adds the level's denied tools to `disallowedTools` and strips them from `allowedTools`, applied _after_ the dontAsk allowlist so a deny always wins. |
| **Codex**                                  | Maps onto its native sandbox tiers as a **ceiling**: `resolveSandboxPolicyType` narrows the seat's tier and can never widen it.                                             |
| **Everything else**                        | Not supported. The node is refused at spawn (below).                                                                                                                        |

**Where the shell sits is the one judgement call.** `Bash` is denied at `none` but allowed
at `read`, because `read` exists for reviewer nodes that run tests, linters and git
queries, and denying the shell would make the level useless for its main purpose. The
trade is explicit: `read` bounds _tools_, and a shell can still write. A node that must
not touch the workspace at all is `none`.

> **A seat that cannot enforce it refuses the run.** Before spawning, the daemon checks the
> resolved provider's `supportsWorkspaceAccess` capability and throws, naming the node, the
> level and the provider. Silently running a node that asked for `read` with full access is
> precisely the failure this feature exists to prevent, so **never set that capability flag
> without the enforcement behind it.**

## Retry and time limit

**Retry** (`GraphNode.retry`) is resilience, distinct from **Loop**, which is quality
iteration: a loop re-runs work that succeeded but wasn't good enough; a retry re-runs work
that never completed. Retry wraps the whole node including its loop.

Two invariants:

- **One loop, one counter.** Retry is never re-entered from the failure path. The prior
  art this design studied re-enters `executeStep` from its own catch block with a fresh
  allowance at every level, so a persistently failing step retries forever.
- **Every attempt is charged to the run.** Retries spawn through the same capped path as
  any other agent, so they count against `maxAgents` and the concurrency semaphore. A
  retry is never a private allowance.

Backoff is `backoffMs * multiplier^(attempt-1)` (multiplier defaults to 2) and ends early
if the run is canceled.

**Time limit** (`GraphNode.timeoutMs`) must _cancel_, not merely stop waiting — an
abandoned agent keeps running and keeps spending. On expiry the engine calls the port's
`cancelAgent`, marks `RunPhase.timedOut`, and fails the node; its retry policy may then
catch it, and independent branches finish normally. Otto can do this because node agents
are managed processes; an in-process engine cannot.

## Prompt templates and snippets

`prompt-template-store.ts` (persistence, mirrors `GraphStore`) and `prompt-render.ts`
(EJS). Stored at `$OTTO_HOME/prompt-templates/`. A template with `snippet: true` is meant
to be included by others; `include("id")` resolves **against the store, not the
filesystem**, because templates are host records rather than files.

A node binds one with `GraphNode.promptTemplate` — `{ templateId, variables }`, where a
variable is a literal, `$inputs.<key>`, or `$output.<nodeId>.<field>`. An unresolvable
reference renders empty rather than leaking its own syntax into the prompt, where it would
read as an instruction.

**Failure degrades, never blocks.** A deleted template, a syntax error, or a host without
the store falls back to the node's inline prompt and logs. This is the one place a
fallback is right: otherwise removing a shared snippet breaks every graph that referenced
it.

The convention the starters demonstrate: the _driver instruction_ stays in the node, and
reusable _behavioural rules_ live in a snippet (`submit-rules`). Repeating those rules in
every node is duplication and tokens on every dispatch.

> **SECURITY:** EJS compiles templates to JavaScript that runs in the daemon process.
> Acceptable today because templates are authored locally by the machine's own user — the
> same trust level as a workspace script. **The day templates become shareable or
> importable, this is a code-execution vector and needs an explicit trust gate.**

## Authoring these in the designer

Every node property on this page is editable from the node card's **Advanced** disclosure —
workspace access, output fields, retry, time limit, Otto tool groups, query tools and the
prompt-template binding. Edge properties (**condition**, **fields carried**) live in an
inspector panel that opens when you select a wire. The disclosure opens on its own whenever
any of them is set, because a collapsed card that hides a real constraint reads as a plain
node.

Three of them use one-per-line text forms rather than repeating row editors, because a
320px node card has no room for a nested table:

| Property           | Form                                  | Notes                                                                                                                                |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Output fields      | `name : type : description`           | Trailing `?` = optional. A bare name is a required string. Splits on the first two colons only, so a description may contain colons. |
| Query tools        | `name \| kind \| spec \| description` | Pipe, not colon — a URL carries colons. `spec` is the argv line, URL or path.                                                        |
| Template variables | `name = value`                        | Splits on the first `=`, so a value may contain one.                                                                                 |

**Query-tool parameters are derived, not declared.** Each `{{name}}` in the spec becomes a
string parameter — the substitution syntax already names them, and a parameter nothing
substitutes is one the tool cannot use. That is lossy against a hand-authored tool with
typed or described parameters, so `parseQueryTools` takes the node's existing tools and
hands back the **original object** for any line that still formats identically. Editing a
line rewrites it in the simple form; leaving it alone keeps every detail.

**Otto tools is tri-state, and the third state matters.** "Whatever the policy allows"
writes no `tools` property at all; "Only these groups" writes the array — including an
_empty_ array, which is the real declaration "no Otto tools". Never collapse the empty
array to absent on save: they mean opposite things.

> **Round-trip safety.** The canvas rebuilds every node and edge from its own state on
> export, so any property it cannot edit is explicitly carried across
> (`carryUneditedNodeFields` / `carryUneditedEdgeFields` in `graph-doc.ts`, keyed
> `from→to` for edges). Without that, opening a graph that uses a capability the designer
> has no control for and pressing Save would silently delete it. **When you add a node or
> edge property, either add a control for it or confirm it survives the round-trip** —
> `graph-doc.test.ts` is where that is proven. `CANVAS_OWNED_NODE_KEYS` must list exactly
> what `buildGraphNode` writes: a property with a control that is missing from the set is
> written twice (harmless), but a property in the set with no control is **deleted on
> save**, which is the failure this guard exists to prevent.

## Gotcha: schema declaration order in the protocol

`zod-aot` loads `packages/protocol/src/orchestration.ts` at codegen time, so a schema
referenced before its `const` is initialised fails the **build** (`ReferenceError: Cannot
access 'X' before initialization`) even though typecheck passes. Declare a schema above
its first use.

## Invariants

1. A skip is never an error, and always carries a machine-readable reason.
2. A run never reports done while silently omitting part of the graph.
3. An unknown field type accepts; it never fails a run.
4. `submit_output` reaches every provider through the per-agent Otto tool catalog — no
   provider branch in the engine.
5. Validation failure is a correctable tool error, not a thrown parse error.
6. A condition that cannot be evaluated fails its node; it is never a quiet false.
7. A node's tool allowlist intersects the daemon's; it can only narrow.
8. Workspace access is enforced by withholding tools, never by prompting.
9. A provider advertises `supportsWorkspaceAccess` only if it actually withholds; a node
   asking for restricted access on a seat that can't enforce it is refused, never
   silently run with full access.
10. Query-tool safety is structural (no shell, no headers, resolved-path check), not
    validated.
11. Retry is one bounded loop, never re-entered from the failure path, always charged to
    the run's caps.
12. A time limit cancels the agent; it never just stops awaiting it.
13. A template that cannot render degrades to the inline prompt.
