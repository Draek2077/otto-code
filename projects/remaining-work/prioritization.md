# Charter prioritization — scored backlog and build order

Companion to [remaining-work.md](remaining-work.md). That file is the _inventory_ of
everything open; this file is the _judgement_ — what each initiative costs, what it is
worth, and the order to build them in.

**Assessed 2026-07-24** against the working tree, not against the charter headers. Every
"unbuilt" claim below was checked by grepping `packages/*/src` for the feature's own
identifiers; every "shipped" claim was checked with `git ls-files`. Re-run those checks
before trusting this doc more than a month from now.

---

## 1. Status corrections found while scoring

Five entries in the CLAUDE.md Projects table disagreed with the tree. Corrected in the
same pass that produced this file:

| Charter said                                             | Tree says                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| first-time-wizard — "**PLANNED**, not yet locked"        | Shipped: `packages/app/src/screens/setup-wizard/` (17 files) + `packages/app/e2e/first-time-wizard.spec.ts`                                   |
| context-management — "BUILT (uncommitted)"               | Committed: `packages/app/src/context-management/` (14 files)                                                                                  |
| orchestration-graphs — "In build (started 2026-07-20)"   | Committed: `packages/server/src/server/orchestration/` (23 files)                                                                             |
| browser-tabs — charter, no status line                   | Shipped: `browser_focus_tab` / `browser_page_text` live in `browser-tools/tools.ts`. Owes its own "fold into docs/preview.md and delete" step |
| sidebar-reveal — "Increment 1 implemented (uncommitted)" | Committed: `use-sidebar-reveal-controller.ts`, `use-reveal-active-workspace.ts`, `sidebar-row-anchors.ts`. Increment 2 still unbuilt          |

Seven folders existed with no row in the table at all: `agent-orchestration`,
`browser-tabs`, `bug-reporting`, `multiplayer`, `sidebar-reveal`, `token-cost-audit`,
`token-cost-fixes`. Added.

Confirmed genuinely unbuilt by grep (zero hits in `packages/*/src`): steer-queue
(`delivery.*queue`), personality-memory (`remember_`), computer-use (`computerUse`),
diff-base (`diffBase`), preview-file-tabs (`isPreviewTab`), git-hosting GitLab
(`gitlab`), visualizer Arena (`arenaMode`), subagent-liveness 6b/6c (`toolUseCount`).
Mermaid: one hit repo-wide, so file-rendering's headline item is untouched.

---

## 2. Scoring rubric

**Impact means one thing only: what changes for a developer using Otto to do their
actual work.** Not engineering value, not risk retired, not mission tidiness. If a user
running Otto on a real project would not notice it, its impact is 1 — however valuable
the work is on other grounds.

_Rubric correction, 2026-07-24 (product owner):_ the first version of this file scored
e2e-qa-coverage impact **5**. That was wrong. Tests have **zero** user-facing impact;
what they have is risk-reduction, which had been silently folded into the impact axis
and pushed a no-user-value item to the top of the build order. Risk-reduction and
unblocking now live on their own axis (**Enablement**) where they cannot inflate a
priority. Keep them separate.

Four axes. **Scope** is surface area. **Difficulty** is technical risk and unknowns, not
volume. **Impact** is user-facing value, per above. **Enablement** is what the work
retires or unlocks for _other_ work.

| Score | Scope                                   | Difficulty                          | Impact (user-facing)                                                                        |
| ----- | --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| 1     | One file / one settings panel           | Mechanical; the plan is the work    | **Invisible to the user** — tests, refactors, docs, internal hygiene                        |
| 2     | One package                             | Known pattern, some care            | Polish. Noticed, but nobody's day changes                                                   |
| 3     | Two packages + protocol                 | New design inside a known subsystem | A real fix or feature you'd hit in a normal working session                                 |
| 4     | Daemon + protocol + client + tests      | Genuine unknowns, cross-provider    | **Removes a blocker or daily friction in a core workflow** — git, editor, chat, supervision |
| 5     | New subsystem or cross-cutting refactor | Research-grade; could fail          | Changes what a developer can _do_ with Otto                                                 |

| Enablement | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| 0          | Stands alone                                               |
| 1          | Retires risk — makes other work safer or cheaper to verify |
| 2          | Unblocks one other charter                                 |
| 3          | Unblocks several charters, or gates a whole wave           |

**Order by Impact first.** Enablement breaks ties and justifies pulling something
forward, but it can never substitute for user value. A high-Enablement / low-Impact item
belongs on a background track, not at the head of the queue — that is exactly the mistake
this correction fixes.

---

## 3. The scored backlog

### 3.1 Blocking a core workflow — head of the queue

Every row here is something a developer hits while trying to get work done in Otto today.
This is where the queue starts.

| Project                             | Scope | Diff | Impact | Enab | Why here                                                                                                                                                                                 |
| ----------------------------------- | :---: | :--: | :----: | :--: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push-disabled-after-commit**      |   1   |  2   | **4**  |  0   | You commit and cannot push. A core git workflow is dead on GitHub remotes. Already root-caused to exact line ranges in [remaining-work.md](remaining-work.md) — pure execution           |
| **App-wide FPS degrades over time** |   3   |  4   | **4**  |  1   | The app gets worse the longer it stays open — brutal for a tool you leave running all day. Measure first; "no resource reporting at all" is the instrument. Underrated in v1             |
| **diff-base**                       |   2   |  2   | **4**  |  0   | Changes view fills with other teams' merged work on a stacked branch. The feature is effectively unusable there. Field report, correctness bug                                           |
| **Go-to-definition (client half)**  |   2   |  2   | **4**  |  0   | IDE table stakes, and the daemon `code.symbols` RPC **already shipped** — the client just never calls it. Best impact-per-hour on the board. `projects/todos/editor-go-to-definition.md` |
| **steer-queue**                     |   2   |  3   | **4**  |  1   | Changes every supervision interaction: today any prompt to a busy agent clobbers its turn. Absorbs "queued messages should merge into one send"                                          |
| Composer paste overflow             |   1   |  1   |   3    |  0   | Pasting a large block pushes Send off-screen. You paste code all day                                                                                                                     |
| **file-rendering (mermaid first)**  |   3   |  2   |   3    |  1   | Mermaid is a _listed bug_. Diagrams are dead in both chat and the file viewer; one pipeline fixes both                                                                                   |
| Keyboard shortcut overhaul          |   3   |  3   |   3    |  0   | Editor shortcuts fight Otto's global ones. Hit constantly; plan already written                                                                                                          |

### 3.2 Small tails worth taking opportunistically

| Project                      | Scope | Diff | Impact | Enab | Why here                                                           |
| ---------------------------- | :---: | :--: | :----: | :--: | ------------------------------------------------------------------ |
| `projects/todos/` (rest)     |   2   |  1   |   3    |  0   | Pre-extracted as independently-pullable by design                  |
| preview-file-tabs            |   2   |  2   |   3    |  0   | Feasibility already confirmed — "no blockers, just work"           |
| subagent-liveness 6b/6c      |   2   |  2   |   3    |  0   | "Is this thing alive or hung?" without opening the row. 6a shipped |
| Visualizer actions disappear |   1   |  2   |   2    |  0   | Long bash/read/write shows, hides, reappears on completion         |
| web-search-providers         |   1   |  1   |   2    |  0   | Contained to one provider settings panel; free engines only        |
| sidebar-reveal Increment 2   |   1   |  2   |   2    |  0   | Tutorial create-workspace step; primitive already shipped          |

### 3.2b Background track — real value, but **not** user-facing

Kept off the main queue by construction. These are Enablement plays; scoring them on
Impact is what produced the v1 mistake. Run them alongside feature work, never instead of
it.

| Project                       | Scope | Diff | Impact | Enab | Note                                                                                                                                                                   |
| ----------------------------- | :---: | :--: | :----: | :--: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e2e-qa-coverage — iron-out    |   3   |  3   | **1**  |  1   | 37 specs that had never executed. **Zero user-facing impact**; buys confidence in everything else. In flight 2026-07-24 — finish it, then treat coverage as continuous |
| Registry reconciliation       |   1   |  1   | **1**  |  2   | Done 2026-07-24. Invisible to users; every later estimate depended on it                                                                                               |
| ~~duplicate-base-workspaces~~ |   —   |  —   |   —    |  —   | **DONE 2026-07-24** — verdict delivered (prevent and steer to a worktree), project archived. See `docs/workspace-lifecycle.md`                                         |

### 3.3 Mission-critical parity

The fork's thesis — a capability isn't done when one provider has it.

| Project                                    | Scope | Diff | Impact | Enab | Why here                                                                                                                                                         |
| ------------------------------------------ | :---: | :--: | :----: | :--: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **observed-subagents — provider adapters** |   4   |  4   | **4**  |  1   | Impact is **conditional on the user's provider**: 5 if you run OpenCode/Codex/Pi (you currently see nothing), 1 if you run Claude (already have it)              |
| **upstream-subagent-convergence**          |   3   |  4   | **1**  |  3   | Invisible to users — it is divergence-cost work. Scores 1 on impact and earns its slot purely on Enablement: skip it and the adapters get written twice (trap 1) |
| total-token-accounting                     |   3   |  3   |   3    |  1   | The numbers are wrong today, which erodes trust in the cost display — but it doesn't block anyone's work                                                         |
| visualizer-node-richness (context ring)    |   3   |  3   |   2    |  2   | Shares instrumentation with usage-log View B — build the hard part once (trap 3)                                                                                 |
| workflow-decomposition follow-ups          |   2   |  3   |   2    |  0   | Path B built + live-verified; only the tail remains                                                                                                              |

### 3.4 Big new capability

| Project                 | Scope | Diff | Impact | Enab | Why here                                                                                                                                           |
| ----------------------- | :---: | :--: | :----: | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **refine**              |   3   |  3   | **5**  |  2   | The AI rewrite is the operation people actually reach for, and Otto supports it worst. Also unlocks context-compaction + editor "explain" (trap 2) |
| **personality-memory**  |   3   |  3   | **4**  |  1   | Every spawn starts from zero today, so the same corrections get re-taught forever. Compounding daily value                                         |
| history-management      |   3   |  2   |   3    |  0   | Archive is a one-way door with no delete anywhere in the app. Annoying and untidy rather than blocking                                             |
| **agent-orchestration** |   5   |  5   | **5**  |  1   | Changes what a developer can do with Otto at all. But a quarter, not a sprint — see Wave 5                                                         |

### 3.5 Long horizon

| Project                       | Scope | Diff | Impact | Enab | Why here                                                                                                                                        |
| ----------------------------- | :---: | :--: | :----: | :--: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **computer-use Phase 0 only** |   2   |  2   | **4**  |  2   | openai-compat **vision** — paste a screenshot at a local model and have it see. Charter says it is independently valuable. Cheap; take it early |
| **mobile-daemon**             |   5   |  5   | **5**  |  0   | Otto with no desktop at all. Highest ceiling on the board; gated on session-decomposition                                                       |
| computer-use (rest)           |   5   |  5   |   4    |  0   | Per-OS scaling, Wayland, permission dialogs, kill-switch semantics                                                                              |
| dictation-refine              |   3   |  3   |   3    |  0   | Unpunctuated local-Parakeet output is a daily annoyance if you dictate. Latency ladder well-specified                                           |
| git-hosting GitLab            |   3   |  2   |   3    |  0   | Impact conditional on the user's forge — a 5 for GitLab shops, 1 otherwise. Layer already abstracted                                            |
| git-file-history presentation |   2   |  2   |   3    |  0   | Capability shipped 0.6.6; side pane + gutter blame + mobile remain                                                                              |
| bug-reporting                 |   2   |  2   |   2    |  1   | Impact lands on the _host owner_, not the developer using Otto. Real, but a different user                                                      |
| session-decomposition         |   5   |  4   | **1**  |  3   | 9,116-line god file. **Zero user-facing impact** — pure debt. Its whole case is Enablement, conditional on mobile-daemon (trap 4)               |
| multiplayer                   |   5   |  5   |   3    |  0   | Charter is explicitly questions-first; design not settled                                                                                       |
| visualizer-pip Arena mode     |   2   |  3   |   2    |  0   | PIP and audio-while-closed both shipped; Arena is the tail                                                                                      |

### 3.6 Non-product track

Real work, but it does not compete for the same hours as the product backlog.

| Project                          | Scope | Diff | Impact |
| -------------------------------- | :---: | :--: | :----: |
| marketing-strategy               |   2   |  2   |   3    |
| outreach                         |   4   |  3   |   3    |
| site-demos (remaining scenarios) |   3   |  2   |   3    |

### 3.7 Reference only — not work

`text-effects` (reference doc for the working-text-effect registry), `token-cost-audit`
(investigation, complete), `token-cost-fixes` (work packages, complete — retains open
product decisions only), `gated-multi-root` (Phase 3 deferred as defense-in-depth),
`git-hosting-providers` (shipped 0.5.0), `browser-tabs` (shipped; owes a fold-and-delete).

---

## 4. Four ordering traps that outrank the scores

**1 — upstream-subagent-convergence must precede the provider adapters.** The single
biggest trap in the backlog. Building OpenCode / Codex / ACP / Pi adapters on Otto's
current observed model and _then_ reconciling with upstream's `v0.1.107` implementation
means writing those adapters twice. The convergence charter says the collision "sits in
the files with the heaviest churn on both sides." Land the merge, converge, then fan out.

**2 — Refine is three features wearing one charter.**
[refine.md](../refine/refine.md) grew out of context-management §7.4, which deferred AI
compaction _precisely because this loop did not exist_. The registry's "Explain this to
me over a selection" is the read-only sibling of the same loop. Build Refine first and
two other backlog items become presets instead of projects.

**3 — Instrument context composition exactly once.** The registry already flags it: the
usage log's per-row composition (View B) and the visualizer's context ring both need
exact-injected accounting that does not exist yet. Two charters, one instrumentation
job. Doing them separately means building the hard part twice.

**4 — session-decomposition's priority is conditional, not intrinsic.** As tech debt it
scores impact 3. As the hard gate on mobile-daemon it is effectively a 5. That one
product call — is mobile-daemon a this-year thing? — reprioritizes a ~9k-line refactor.
Decide it before scheduling either.

---

## 5. Recommended order

**Re-cut 2026-07-24** after the §2 rubric correction. The waves below are ordered by
user-facing impact. Enablement work no longer occupies a wave of its own — it runs on a
background track (§3.2b) in parallel, because it does not deliver anything to a user and
must not displace work that does.

### Wave 0 — in flight, closing out

Commit the working tree. ~~Apply the §1 status corrections~~ (done). ~~Take the
duplicate-base-workspaces verdict~~ (done, archived). Finish the e2e iron-out already
running — batch by batch per [iron-out.md](../e2e-qa-coverage/iron-out.md), **never the
full suite at once** ([CLAUDE.md](../../CLAUDE.md) critical rules).

Retained as-is because it is nearly done, **not** because it earned the slot. Under the
corrected rubric this is a Wave-1-impact-1 background item; it should not have led the
plan. Once it closes, coverage becomes continuous, not a phase.

### Wave 1 — unblock the daily workflow

Everything a developer hits while trying to use Otto for real work. Highest impact per
hour on the board, and all of it independently shippable.

1. **Push-disabled-after-commit** — root-caused; pure execution
2. **Go-to-definition, client half** — daemon RPC already shipped, best impact-per-hour
3. **diff-base** — Changes view unusable on stacked branches
4. **Composer paste overflow** — trivial fix, hit constantly
5. **Mermaid** — via file-rendering; lights up chat + viewer together

### Wave 2 — supervision and editing feel

The two things you do all day in Otto that currently feel worst.

1. **steer-queue** — stop clobbering a running turn to add a thought
2. **refine** — the AI rewrite loop with review (trap 2: also unlocks context compaction
   and the editor's "explain this" action, converting two backlog items into presets)
3. **Keyboard shortcut overhaul** — editor scope that overrides Otto's globals
4. **subagent-liveness 6b/6c** — "alive or hung?" without opening the row

### Wave 3 — the performance floor

**App-wide FPS degradation.** Split out because it is measurement-first and open-ended:
build the resource reporting, find the leak, fix it. Impact 4 — the app degrading over a
long session is exactly the failure mode a leave-it-running monitoring tool cannot have.
Pull earlier if it worsens.

### Wave 4 — provider parity and continuity

1. **upstream merge → subagent convergence → provider adapters** (trap 1, non-negotiable
   order). Impact here is conditional: transformative for OpenCode/Codex/Pi users,
   invisible to Claude users. Sequence it by who your users actually are
2. **personality-memory** — stop re-teaching the same corrections every spawn
3. **computer-use Phase 0** (openai-compat vision) — cheap, self-contained, high ceiling
4. Shared context instrumentation → visualizer ring + usage-log View B (trap 3)
5. **total-token-accounting** · **history-management** — trust and tidiness

### Wave 5 — the big bet

Pick **one** of agent-orchestration or (session-decomposition → mobile-daemon). Both are
quarter-scale and both are strategically defensible; running them concurrently in one
shared working tree is not. Note session-decomposition is an impact-1 refactor that only
makes sense as mobile-daemon's prerequisite (trap 4) — if mobile-daemon is not the pick,
do not do it.

### Deferred indefinitely

multiplayer · visualizer Arena mode · computer-use beyond Phase 0 · bug-reporting
(different user) · git-hosting GitLab (until a GitLab user exists).
