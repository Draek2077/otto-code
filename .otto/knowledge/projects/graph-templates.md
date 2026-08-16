---
id: "graph-templates"
kind: "project"
title: "Graph Templates"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:55.142Z"
updated_at: "2026-08-16T13:40:35.666Z"
---

# Graph Templates

<!-- compiled_truth -->

# Graph Templates & Evaluation - do the graphs actually work?

**Status:** charter. The engine-side "Decided, not built" records (now in Otto Knowledge, not `archdocs/`) are inputs to this; status lives in `projects/README.md`.

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

---

## Companion document: use-cases.md

# Orchestration use cases - the catalog

Companion to [graph-templates.md](graph-templates.md). Each entry is a candidate graph
template: the outcome it produces, why a fixed graph beats prompting an agent solo, and its
shape. The catalog exists to test the system's efficacy against real, varied demand - not to
flatter it. Entries that expose a missing capability say so; the collected gaps feed the
charter's dependency list.

**Reading an entry:** _Needs: built_ means the graph is authorable today. Named gaps -
_gate_ (gate node + persisted pause + form), _map_ (dynamic fan-out), _values_ (run values),
_check_ (deterministic check node), _isolation_ (per-node worktrees), _schedule_ (recurring
trigger) - are the charter's dependencies.

## The recurring shapes

Seven shapes cover nearly everything below. Naming them keeps the entries short, and each is a
candidate for its own minimal starter template.

| Shape                  | What it is                                                                                                                            | Status                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Item fan-out**       | Enumerate a work-list, one worker per item, judge each, synthesize. The shape orchestration demonstrably wins at.                     | needs _map_ for runtime lists           |
| **Bake-off**           | N independent attempts at one brief from different casts; judge panel scores; human picks; winner hardened. For wide solution spaces. | needs _isolation_ for writing bake-offs |
| **Iterate-until-pass** | A worker loops under a judge or a deterministic check until criteria pass or the cap trips.                                           | built (`loop.until`)                    |
| **Gate as input**      | The gate's form is how the human _feeds_ the run - inventory, answers, preferences - not just approves it.                            | needs _gate_                            |
| **Teaching track**     | A read-only teacher node rides alongside the work, explaining and quizzing the human at gates.                                        | needs _gate_, _values_                  |
| **Scheduled digest**   | The same graph runs on cadence, reads its own previous artifact (files as memory), delivers an updated one.                           | works via a scheduled conductor         |
| **Ground-truth check** | A command's exit code, numbers or diff judges the work - no model opinion involved.                                                   | needs _check_                           |

## Software development

1. **Full development process** - the flagship. Research → plan → **gate: human approves the
   plan** → implement → check (tests actually run) → verify → deliver. Fixes the methodology
   that naked prompting re-invents every session. _Needs: gate, check._

2. **Bug hunt** - write a failing repro first (check: it fails _before_ the fix - ground
   truth), localize via read-only fan-out, N candidate fixes as a bake-off, check: repro passes
   and the suite stays green, deliver the smallest passing diff. _Needs: check, isolation._

3. **Migration sweep** - inventory call sites with a query tool, one transform per site,
   check builds per step, roll-up report. The canonical item fan-out. _Needs: map, check,
   isolation._

4. **Code review board** - diff intake → parallel reviewers with distinct lens personalities
   (correctness, security, performance, a11y) → adversarial verifier per finding → dedupe →
   report with file/line evidence. Read-only throughout, so it is safe today - **the best
   first template.** _Needs: built._

5. **Test-coverage builder** - coverage report (check) → gap list → one test-writer per gap →
   run the new tests (check) → judge quality (not just existence) → PR. _Needs: map, check._

6. **Dependency upgrades** - audit outdated (query tool) → risk-rank → sequential upgrade
   loop with a check after each, retry-with-backoff on transient failures, stop-and-report on
   hard ones. Exercises retry semantics as designed. _Needs: check._

7. **Performance investigation** - baseline measurement (check) → hypothesis fan-out
   (read-only) → gate: human picks which to try → experiment → re-measure → **numbers judge
   the work**. The showcase for deterministic scoring. _Needs: gate, check, isolation._

8. **Release readiness** - parallel checks (version sync, changelog, licenses, smoke tests) →
   writer drafts notes → gate: human approves → deliver artifacts. _Needs: gate, check._

9. **Docs drift sweep** - enumerate doc pages, per page compare claims against code, flag
   drift, rewrite, verify paths and commands still resolve (check), PR. This chat performed
   the manual version of exactly this graph. _Needs: map, check._

10. **Prototype bake-off** - one spec, three implementations from differently-cast
    personalities, judge panel against declared criteria, gate: human picks, winner hardened.
    _Needs: gate, isolation._

## Technical & product design

11. **Architecture decision record** - researchers from declared angles → option drafts →
    adversarial review per option → comparison matrix → gate: human decides → final ADR
    artifact. Decision _support_, with the decision staying human. _Needs: gate._

12. **API design by consumption** - draft spec → simulated consumers each write client code
    against it → friction findings → revise until a judge passes → spec artifact. Catches
    what review misses: an API's problems appear when someone uses it. _Needs: built._

13. **UX critique board** - screens or spec intake → critics by lens (accessibility,
    consistency, compact/mobile) → synthesized, prioritized findings with evidence →
    annotated-mockup artifact. Read-only; safe today. _Needs: built._

## Writing, content & presentation

14. **Book pipeline** - premise via gate form → outline → gate: author approves → chapters
    via map, with a **continuity bible in run values** (characters, facts, timeline -
    `append`, attributed by node) → continuity editor pass → per-chapter revision loop →
    compiled artifact. The strongest run-values showcase. _Needs: gate, map, values._

15. **Presentation builder** - brief via gate form → narrative arc → slide drafts (writer) →
    design pass (designer) → speaker notes → deck artifact - then an optional **rehearsal
    track** that quizzes the presenter on their own material. _Needs: gate._

16. **Game prototype loop** - design brief → gate → implement → **playtest node drives the
    Otto preview browser** (boots? console clean? scripted interactions work?) → tuning loop
    until playable → build artifact. Exercises per-node tool groups against the preview
    subsystem - a combination no surveyed competitor has. _Needs: gate, check._

## Personal & life

17. **Weekly life ops digest** - scheduled; query tools read calendar exports and task files →
    conflicts and priorities surfaced → digest artifact each morning it runs. _Needs:
    schedule (works via scheduled conductor today), gate for preferences._

18. **Meal plan & groceries** - gate form: pantry contents, diet, budget → plan under
    constraints → grocery list artifact grouped by aisle → **deterministic budget sum**
    (check). Gate-as-input, end to end. _Needs: gate, check._

19. **Coaching check-in** - scheduled; reads last check-in's artifact (files as memory) →
    gate form: journal entry → a coach personality reflects against history → commitments
    artifact → next run opens by asking about follow-through. _Needs: gate, schedule._

20. **Job search campaign** - postings list → per posting: company research (read-only) +
    tailored materials (writer) → consistency check against the master resume → tracker
    artifact updated per run. _Needs: map, gate._

21. **Learning curriculum** - the teacher generalized: goal via gate form → curriculum →
    per topic: teach, exercise, **gate: the human answers** → grade (deterministically where
    checkable) → the next topic adapts to the answers → progress artifact. Pure-teach variant
    of Perform-and-Teach. _Needs: gate, values._

22. **Event planning** - requirements form → venue/vendor research fan-out → budget
    reconciliation (deterministic) → timeline and checklist artifacts → reminder schedules
    created as a deliverable. _Needs: gate, check._

## What the catalog demands - tallied

Counting needs across the 22 entries, in order of leverage:

| Gap                                 | Demanded by | Note                                                                                                                                                                                    |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gate** (+ persisted pause + form) | 15 entries  | The single highest-leverage build. Gate-as-_input_ - the form - is what unlocks every personal use case, and the designed `form: GraphInput[]` reuse is validated hard by this catalog. |
| **check**                           | 11          | Ground truth over model opinion; also the cheapest node in the system.                                                                                                                  |
| **map**                             | 6           | Runtime work-lists. Also a convergence prerequisite.                                                                                                                                    |
| **isolation**                       | 4           | Every writing bake-off and sweep. Read-only entries dodge it - which is why the review board ships first.                                                                               |
| **values**                          | 3           | Fewer entries, but the book pipeline and teaching depend on it entirely.                                                                                                                |
| **schedule**                        | 3           | Already works via a scheduled conductor; direct binding is polish.                                                                                                                      |

Three conclusions the tally forces:

- **The build order in the charter is confirmed, with one amendment:** gate and check
  together unlock 18 of 22 entries; map, isolation and values follow. Per-node accounting
  still precedes all of it - without measurement, none of these can prove they beat solo.
- **Ship read-only templates first.** The review board (4), API-by-consumption (12) and UX
  critique (13) are authorable _today_, exercise judging and synthesis, and cannot conflict
  in a shared tree. They are the harness's first subjects.
- **AI graph authoring multiplies the catalog.** Most entries are a shape plus domain
  wording. Once a conductor can emit and save graphs (charter workstream 3), "make me one of
  these for my project" becomes a prompt - with the shared validation gate and the designer
  keeping the human able to read what they are about to run.

## Timeline

- time: "2026-08-08T06:17:55.142Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:55.142Z"
  kind: "evidence"
  summary: "Migrated from `projects/graph-templates/graph-templates.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: **Do the graphs actually work?** The measurement layer (per-node accounting, capability scoring, multi-mechanism grading, a T2 golden-graph harness) plus the starter-template library (Plan–Execute–Verify, review sweep, research→synthesize, full dev process, **Perform and Teach**). Engine-side decisions it builds on: `archdocs/pages/12` §\"Decided, not built\""
- time: "2026-08-08T06:19:47.076Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
- time: "2026-08-16T13:40:35.666Z"
  kind: "decision"
  summary: "Retiring archdocs/: the single \"Decisions in archdocs/pages/12... §Decided, not built\" pointer (top status line) now resolves to the five Otto Knowledge records. All other lines of the charter and the use-cases catalog are byte-identical to the restored original."
