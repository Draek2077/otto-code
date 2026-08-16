# Graph Templates & Evaluation - do the graphs actually work?

**Status:** charter. The engine-side "Decided, not built" records (now in Otto Knowledge, not
`archdocs/`) are inputs to this; status lives in `projects/README.md`.

## Thesis

The orchestration engine is built and sound. The open question is the one that decides whether
the whole direction pays off: **can a person author a graph template that reliably beats one
good agent doing the task solo?** That is not settled by argument - only by running real tasks
through candidate templates and measuring.

The product motivation, in the owner's words: prompting naked means a different methodology
every time. Skills are something an agent _uses_; they are not the overarching process. A graph
template fixes the methodology - build, study, test, verify - and casting nodes with
personalities and roles means each step is done _with purpose_. The template is the process
made repeatable.

## The two workstreams

### 1. The measurement layer (precondition)

You cannot compare templates without a per-node record. In build order:

1. **Per-node accounting** - `startedAt`/`completedAt`, tokens/cost rolled up from the child
   agent's own accounting, tool-call count. Lands on `RunPhaseCandidate`. Shape informed by
   AgentX-Python's trace unit (`docs/references.md` §2.1).
2. **Capability scoring** - a per-run scorecard computed from the record: did it settle `done`;
   verdict pass rates per node; retries and loop iterations spent; total tokens, cost,
   wall-clock, and **action count** (tool calls). The unit for "did this work, and at what
   price."
3. **More than one grading mechanism.** Deterministic checks where the answer is checkable
   (the `check` node: command + expectation, no model - ground truth); similarity scoring where
   a reference answer exists; an LLM judge only where neither applies. Today Otto has only the
   judge - the most expensive and driftiest of the three.
4. **A golden-graph harness on the T2 local-AI tier** - the same real tasks run through
   candidate templates, scored with the mechanisms above, zero API spend. This is the
   experiment that answers the thesis question.
5. **Patterns (later)** - regression detection over recorded runs: did this template start
   behaving differently than it used to? A template library that accumulates without
   verification decays into noise.

### 2. The template library (the payoff)

Templates are starter graphs - the existing `builtIn` + copy-on-edit mechanism. **The full
catalog, including non-coding domains, is [use-cases.md](use-cases.md)** - the recurring shapes,
~20 concrete orchestrations, and the engine gaps the catalog surfaces. Flagship candidates, in
rough order of confidence that they beat solo:

- **Plan–Execute–Verify** - the requirements-immutable, audit-every-bullet loop. Pure assembly:
  `output.fields`, judges, `until` loops all exist.
- **Review sweep** - fan out over an enumerated work-list (files, findings), judge each,
  synthesize. Fan-out over _items_ is the shape orchestration is known to win at.
- **Research → synthesize** - N researchers from declared angles accumulate findings through
  run values (`append`); a synthesis node reads them. The engine's own proof task.
- **Full development process** - research → plan → gate (human approves the plan) → implement →
  check (tests actually run) → verify → deliver. The phase-run vocabulary reborn as a graph;
  needs the gate node.
- **Perform and Teach** - the same development graph with a teaching track alongside: while
  worker nodes do the work, a teacher node (its own personality, read-only authority) produces
  an explanation of what was done and why, materials, and comprehension questions for the
  human; the gate doubles as the checkpoint where the human answers before work continues.
  Teaching _during_ real work, not a separate tutorial mode.

The last one is the differentiated application: nothing in the surveyed field combines
human-in-the-loop gates with a teaching cast. It composes from pieces already designed -
personalities give the teacher a voice, `access: "read"` keeps it from touching the work,
run values give it the workers' outputs, the gate gives it the human's attention. What it
genuinely needs first: run values and the gate node.

### 3. AI-authored graphs (the convergence)

The conductor eventually emits graphs, not phase plans. MCP graph-authoring tools - author a
graph, save it as a template, start it - let an agent generate its own orchestration shapes,
and let a user say "build me a graph for X" and get a reviewable template rather than an
opaque plan. **Safe by construction:** an AI-authored graph passes the same shared hard gate
(`validateOrchestrationGraph` + `validateEdgeConditions`) as a human-drawn one, and the
designer renders it for review before anyone runs it. This also closes the authoring-cost
loop: complex conditions and output contracts are fiddly to hand-write, and the model that
understands the task is well placed to draft them.

### Cross-run memory is files

Recurring orchestrations (weekly digests, coaching check-ins, trackers) need what the last run
knew. No new store: a run reads its predecessor's artifact - the blackboard-as-files decision
extended across runs. A pattern to document, not a system to build.

## What this depends on (build order upstream of this charter)

1. Durability boot path - a gate that dies on daemon restart isn't a gate.
2. Per-node accounting (workstream 1.1 - everything else measures nothing without it).
3. Gate node + named ports, per the ports/conditions decision. **This step also settles hole
   4** - the gate/check design decides control-node authority baselines, which is the natural
   moment to give deterministic nodes a deliberate preview/terminals widening.
4. Run values, per the scoping decision (opt-in read, `once`/`append` per key).
5. A per-node **turn limit** - the one bound class missing; a node circling for 40 turns
   inside its time limit is invisible to every current cap.
6. Dynamic fan-out (a `map` node) - every use case that iterates a runtime-discovered list
   (chapters, call sites, postings) is unauthorable without it. Also one of the two
   prerequisites for collapsing phase runs into a preset graph (the other is the gate).
7. Per-node worktree isolation - read-only fan-out is safe today; **parallel writing nodes
   share one tree and will conflict.** Bake-offs and migration sweeps need isolated checkouts.

Two facts that shape rollout, not blockers: the whole graph surface is **dev-only** today
(`useOrchestrationGraphsFeature` requires `isDev`), so templates cannot reach users until that
gate lifts; and scheduled orchestrations already work _indirectly_ - a scheduled conductor
agent carries `start_run` - so a direct schedule→graph binding is a UX improvement, not a
dependency.

## Correctness holes (full-set review, 2026-07-25)

Verified in code during the 2026-07-25 full-set review. **1–3 are FIXED** (cancel cascades on
both engines via abort listeners around every child await; the graph path freezes the team
view, roster and template store once at run start - engine tests cover the cascade, and the
phase path already had a per-run role cache):

1. ✅ **Cancel now cascades.** Aborting a run really cancels its in-flight children.
2. ✅ **Seats snapshot at run start.** A mid-run team edit cannot re-cast later nodes or
   change the composed team prompt.
3. ✅ **Templates snapshot at run start.** A mid-run template edit cannot reword later nodes.
4. **A deterministic node can never gain preview/browser.** Tool groups only narrow from the
   policy baseline, and the deterministic policy strips preview/browser - so a
   browser-verified check node is impossible without granting full `autonomous`. Needs a
   deliberate widening mechanism for exactly this case, or preview/browser in the
   deterministic baseline gated by groups.
5. **`http-get` query tools have no host policy** - SSRF-shaped; same local-trust boundary as
   EJS today, must gate before graphs become shareable (recorded in
   `docs/orchestration-node-capabilities.md`).

## Honest expectations

Where templates should win: fan-out over items, per-node acceptance tests, processes a team
repeats. Where they may lose to solo: open-ended feature work where the decomposition _is_ the
hard part. The harness exists to find that boundary, not to confirm the thesis.
