# Orchestration use cases — the catalog

Companion to [graph-templates.md](graph-templates.md). Each entry is a candidate graph
template: the outcome it produces, why a fixed graph beats prompting an agent solo, and its
shape. The catalog exists to test the system's efficacy against real, varied demand — not to
flatter it. Entries that expose a missing capability say so; the collected gaps feed the
charter's dependency list.

**Reading an entry:** _Needs: built_ means the graph is authorable today. Named gaps —
_gate_ (gate node + persisted pause + form), _map_ (dynamic fan-out), _values_ (run values),
_check_ (deterministic check node), _isolation_ (per-node worktrees), _schedule_ (recurring
trigger) — are the charter's dependencies.

## The recurring shapes

Seven shapes cover nearly everything below. Naming them keeps the entries short, and each is a
candidate for its own minimal starter template.

| Shape                  | What it is                                                                                                                            | Status                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Item fan-out**       | Enumerate a work-list, one worker per item, judge each, synthesize. The shape orchestration demonstrably wins at.                     | needs _map_ for runtime lists           |
| **Bake-off**           | N independent attempts at one brief from different casts; judge panel scores; human picks; winner hardened. For wide solution spaces. | needs _isolation_ for writing bake-offs |
| **Iterate-until-pass** | A worker loops under a judge or a deterministic check until criteria pass or the cap trips.                                           | built (`loop.until`)                    |
| **Gate as input**      | The gate's form is how the human _feeds_ the run — inventory, answers, preferences — not just approves it.                            | needs _gate_                            |
| **Teaching track**     | A read-only teacher node rides alongside the work, explaining and quizzing the human at gates.                                        | needs _gate_, _values_                  |
| **Scheduled digest**   | The same graph runs on cadence, reads its own previous artifact (files as memory), delivers an updated one.                           | works via a scheduled conductor         |
| **Ground-truth check** | A command's exit code, numbers or diff judges the work — no model opinion involved.                                                   | needs _check_                           |

## Software development

1. **Full development process** — the flagship. Research → plan → **gate: human approves the
   plan** → implement → check (tests actually run) → verify → deliver. Fixes the methodology
   that naked prompting re-invents every session. _Needs: gate, check._

2. **Bug hunt** — write a failing repro first (check: it fails _before_ the fix — ground
   truth), localize via read-only fan-out, N candidate fixes as a bake-off, check: repro passes
   and the suite stays green, deliver the smallest passing diff. _Needs: check, isolation._

3. **Migration sweep** — inventory call sites with a query tool, one transform per site,
   check builds per step, roll-up report. The canonical item fan-out. _Needs: map, check,
   isolation._

4. **Code review board** — diff intake → parallel reviewers with distinct lens personalities
   (correctness, security, performance, a11y) → adversarial verifier per finding → dedupe →
   report with file/line evidence. Read-only throughout, so it is safe today — **the best
   first template.** _Needs: built._

5. **Test-coverage builder** — coverage report (check) → gap list → one test-writer per gap →
   run the new tests (check) → judge quality (not just existence) → PR. _Needs: map, check._

6. **Dependency upgrades** — audit outdated (query tool) → risk-rank → sequential upgrade
   loop with a check after each, retry-with-backoff on transient failures, stop-and-report on
   hard ones. Exercises retry semantics as designed. _Needs: check._

7. **Performance investigation** — baseline measurement (check) → hypothesis fan-out
   (read-only) → gate: human picks which to try → experiment → re-measure → **numbers judge
   the work**. The showcase for deterministic scoring. _Needs: gate, check, isolation._

8. **Release readiness** — parallel checks (version sync, changelog, licenses, smoke tests) →
   writer drafts notes → gate: human approves → deliver artifacts. _Needs: gate, check._

9. **Docs drift sweep** — enumerate doc pages, per page compare claims against code, flag
   drift, rewrite, verify paths and commands still resolve (check), PR. This chat performed
   the manual version of exactly this graph. _Needs: map, check._

10. **Prototype bake-off** — one spec, three implementations from differently-cast
    personalities, judge panel against declared criteria, gate: human picks, winner hardened.
    _Needs: gate, isolation._

## Technical & product design

11. **Architecture decision record** — researchers from declared angles → option drafts →
    adversarial review per option → comparison matrix → gate: human decides → final ADR
    artifact. Decision _support_, with the decision staying human. _Needs: gate._

12. **API design by consumption** — draft spec → simulated consumers each write client code
    against it → friction findings → revise until a judge passes → spec artifact. Catches
    what review misses: an API's problems appear when someone uses it. _Needs: built._

13. **UX critique board** — screens or spec intake → critics by lens (accessibility,
    consistency, compact/mobile) → synthesized, prioritized findings with evidence →
    annotated-mockup artifact. Read-only; safe today. _Needs: built._

## Writing, content & presentation

14. **Book pipeline** — premise via gate form → outline → gate: author approves → chapters
    via map, with a **continuity bible in run values** (characters, facts, timeline —
    `append`, attributed by node) → continuity editor pass → per-chapter revision loop →
    compiled artifact. The strongest run-values showcase. _Needs: gate, map, values._

15. **Presentation builder** — brief via gate form → narrative arc → slide drafts (writer) →
    design pass (designer) → speaker notes → deck artifact — then an optional **rehearsal
    track** that quizzes the presenter on their own material. _Needs: gate._

16. **Game prototype loop** — design brief → gate → implement → **playtest node drives the
    Otto preview browser** (boots? console clean? scripted interactions work?) → tuning loop
    until playable → build artifact. Exercises per-node tool groups against the preview
    subsystem — a combination no surveyed competitor has. _Needs: gate, check._

## Personal & life

17. **Weekly life ops digest** — scheduled; query tools read calendar exports and task files →
    conflicts and priorities surfaced → digest artifact each morning it runs. _Needs:
    schedule (works via scheduled conductor today), gate for preferences._

18. **Meal plan & groceries** — gate form: pantry contents, diet, budget → plan under
    constraints → grocery list artifact grouped by aisle → **deterministic budget sum**
    (check). Gate-as-input, end to end. _Needs: gate, check._

19. **Coaching check-in** — scheduled; reads last check-in's artifact (files as memory) →
    gate form: journal entry → a coach personality reflects against history → commitments
    artifact → next run opens by asking about follow-through. _Needs: gate, schedule._

20. **Job search campaign** — postings list → per posting: company research (read-only) +
    tailored materials (writer) → consistency check against the master resume → tracker
    artifact updated per run. _Needs: map, gate._

21. **Learning curriculum** — the teacher generalized: goal via gate form → curriculum →
    per topic: teach, exercise, **gate: the human answers** → grade (deterministically where
    checkable) → the next topic adapts to the answers → progress artifact. Pure-teach variant
    of Perform-and-Teach. _Needs: gate, values._

22. **Event planning** — requirements form → venue/vendor research fan-out → budget
    reconciliation (deterministic) → timeline and checklist artifacts → reminder schedules
    created as a deliverable. _Needs: gate, check._

## What the catalog demands — tallied

Counting needs across the 22 entries, in order of leverage:

| Gap                                 | Demanded by | Note                                                                                                                                                                                    |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gate** (+ persisted pause + form) | 15 entries  | The single highest-leverage build. Gate-as-_input_ — the form — is what unlocks every personal use case, and the designed `form: GraphInput[]` reuse is validated hard by this catalog. |
| **check**                           | 11          | Ground truth over model opinion; also the cheapest node in the system.                                                                                                                  |
| **map**                             | 6           | Runtime work-lists. Also a convergence prerequisite.                                                                                                                                    |
| **isolation**                       | 4           | Every writing bake-off and sweep. Read-only entries dodge it — which is why the review board ships first.                                                                               |
| **values**                          | 3           | Fewer entries, but the book pipeline and teaching depend on it entirely.                                                                                                                |
| **schedule**                        | 3           | Already works via a scheduled conductor; direct binding is polish.                                                                                                                      |

Three conclusions the tally forces:

- **The build order in the charter is confirmed, with one amendment:** gate and check
  together unlock 18 of 22 entries; map, isolation and values follow. Per-node accounting
  still precedes all of it — without measurement, none of these can prove they beat solo.
- **Ship read-only templates first.** The review board (4), API-by-consumption (12) and UX
  critique (13) are authorable _today_, exercise judging and synthesis, and cannot conflict
  in a shared tree. They are the harness's first subjects.
- **AI graph authoring multiplies the catalog.** Most entries are a shape plus domain
  wording. Once a conductor can emit and save graphs (charter workstream 3), "make me one of
  these for my project" becomes a prompt — with the shared validation gate and the designer
  keeping the human able to read what they are about to run.
