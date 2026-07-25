# Charter prioritization — scored backlog and build order

Companion to [remaining-work.md](remaining-work.md). That file is the _inventory_ of
everything open; this file is the _judgement_ — what each initiative costs, what it is
worth, and the order to build them in.

**Assessed 2026-07-24, re-assessed 2026-07-25** against the working tree, not against the
charter headers. Every "unbuilt" claim below was checked by grepping `packages/*/src` for
the feature's own identifiers; every "shipped" claim was checked with `git ls-files`. Re-run
those checks before trusting this doc more than a month from now.

**Waves 0, 1 and 2 are complete.** Wave 3 was re-cut on 2026-07-25 — as originally written
it was a single open-ended item whose own measuring instrument did not exist yet, which is
not a runnable wave. See §5.

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
(`delivery.*queue` — since shipped 2026-07-25, so that grep now hits), personality-memory (`remember_`), computer-use (`computerUse`),
preview-file-tabs (`isPreviewTab`), git-hosting GitLab
(`gitlab`), visualizer Arena (`arenaMode`), subagent-liveness 6b/6c (`toolUseCount` —
since shipped 2026-07-25, so that grep now hits).
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

| Project                                            | Scope | Diff | Impact | Enab | Why here                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | :---: | :--: | :----: | :--: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push-disabled-after-commit**                     |   1   |  2   | **4**  |  0   | You commit and cannot push. A core git workflow is dead on GitHub remotes. Already root-caused to exact line ranges in [remaining-work.md](remaining-work.md) — pure execution                                                                                                                                          |
| **App-wide FPS degrades over time**                |   3   |  4   | **4**  |  1   | The app gets worse the longer it stays open — brutal for a tool you leave running all day. Measure first; "no resource reporting at all" is the instrument. Underrated in v1                                                                                                                                            |
| ~~**diff-base**~~ _(shipped)_                      |   2   |  2   | **4**  |  0   | Was: Changes view fills with other teams' merged work on a stacked branch. Shipped 2026-07-24 — fork-point base resolution + per-worktree base override. See `docs/changes-view.md`                                                                                                                                     |
| ~~**Go-to-definition (client half)**~~ _(shipped)_ |   2   |  2   | **4**  |  0   | Shipped: `use-go-to-definition.ts`, `word-at-cursor.ts`, `definition-picker-dialog.tsx` calling `code.symbols`. Note it runs on the **ctags** path — `lsp-code-intelligence` §3.4 replaces that word-based lookup with a position-based one, so this client wiring is rewritten in that charter's Phase 3, not extended |
| ~~**steer-queue**~~ _(shipped)_                    |   2   |  3   | **4**  |  1   | Was: any prompt to a busy agent clobbers its turn. Shipped 2026-07-25 — `delivery: "queue"` on every entrypoint, daemon-owned FIFO drained at turn finalize, all providers at once. Absorbed "queued messages should merge into one send". See `docs/chat-lifecycle.md`                                                 |
| Composer paste overflow                            |   1   |  1   |   3    |  0   | Pasting a large block pushes Send off-screen. You paste code all day                                                                                                                                                                                                                                                    |
| **file-rendering (mermaid first)**                 |   3   |  2   |   3    |  1   | Mermaid is a _listed bug_. Diagrams are dead in both chat and the file viewer; one pipeline fixes both                                                                                                                                                                                                                  |
| Keyboard shortcut overhaul                         |   3   |  3   |   3    |  0   | Editor shortcuts fight Otto's global ones. Hit constantly; plan already written                                                                                                                                                                                                                                         |

### 3.2 Small tails worth taking opportunistically

| Project                      | Scope | Diff | Impact | Enab | Why here                                                    |
| ---------------------------- | :---: | :--: | :----: | :--: | ----------------------------------------------------------- |
| `projects/todos/` (rest)     |   2   |  1   |   3    |  0   | Pre-extracted as independently-pullable by design           |
| preview-file-tabs            |   2   |  2   |   3    |  0   | Feasibility already confirmed — "no blockers, just work"    |
| ~~subagent-liveness 6b/6c~~  |   2   |  2   |   3    |  0   | SHIPPED 2026-07-25 — tool count + current tool on the row   |
| Visualizer actions disappear |   1   |  2   |   2    |  0   | Long bash/read/write shows, hides, reappears on completion  |
| web-search-providers         |   1   |  1   |   2    |  0   | Contained to one provider settings panel; free engines only |
| sidebar-reveal Increment 2   |   1   |  2   |   2    |  0   | Tutorial create-workspace step; primitive already shipped   |

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

| Project                   | Scope | Diff | Impact | Enab | Why here                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | :---: | :--: | :----: | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **refine**                |   3   |  3   | **5**  |  2   | The AI rewrite is the operation people actually reach for, and Otto supports it worst. Also unlocks context-compaction + editor "explain" (trap 2)                                                                                                                                                                                                                                                                                                       |
| **personality-memory**    |   3   |  3   | **4**  |  1   | Every spawn starts from zero today, so the same corrections get re-taught forever. Compounding daily value                                                                                                                                                                                                                                                                                                                                               |
| history-management        |   3   |  2   |   3    |  0   | Archive is a one-way door with no delete anywhere in the app. Annoying and untidy rather than blocking                                                                                                                                                                                                                                                                                                                                                   |
| **agent-orchestration**   |   5   |  5   | **5**  |  1   | Changes what a developer can do with Otto at all. But a quarter, not a sprint — see Wave 5                                                                                                                                                                                                                                                                                                                                                               |
| **lsp-code-intelligence** |   5   |  4   | **4**  |  3   | **Phases 1–5 SHIPPED** 2026-07-25 — definition, hover, diagnostics, references, rename. Impact realised at 5 as predicted: hover/references/rename/diagnostics were new capability on machinery already paid for. Only Phase 4 (solution tie-in) remains, and it moved to `solution-view`                                                                                                                                                                |
| **solution-view**         |   4   |  4   |  3\*   |  1   | _Scored 2026-07-25 — charter v3 approved, cross-platform proven by spike._ \*Impact is **provider-shaped, like the adapters**: a 5 if you work in .NET (the tree Otto shows is not the tree the build sees), a 1 otherwise. A portable 193 KB .NET sidecar owns the domain knowledge because **the LSP gives no project structure at all** — that correction is the charter's spine. Enablement 1: its Phase 2 (general file mutations) is not .NET work |

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

### ✅ Wave 0 — COMPLETE (2026-07-24)

~~Commit the working tree~~ · ~~apply the §1 status corrections~~ · ~~take the
duplicate-base-workspaces verdict~~ (archived) · ~~finish the e2e iron-out~~ — T1 and T2
both green.

Retained at the head of the plan because it was nearly done, **not** because it earned
the slot. Under the corrected rubric it was an impact-1 background item. Coverage is now
continuous, not a phase — see §3.2b.

### ✅ Wave 1 — COMPLETE (2026-07-25)

Everything a developer hits while trying to use Otto for real work. All five shipped,
each verified in the tree rather than from its commit message.

1. ~~**Push-disabled-after-commit**~~ — **shipped** (`92329a728`). The fix corrected the
   brief: the path is **shared**, not GitHub-only — Bitbucket polls at 30s/180s so it
   rarely hits the race window. Server stops the PR-status poll publishing git-tracking
   state (`prStatusOnly` + `gitLoadedAtMs`); client guards on a monotonic stamp
2. ~~**Go-to-definition, client half**~~ — **shipped** (`use-go-to-definition.ts` +
   `definition-picker-dialog.tsx`). It answered from the ctags index, which the later
   LSP work replaces — do not invest further in the word-based path
3. ~~**diff-base**~~ — **shipped** (`706124680`, `docs/changes-view.md`). Only the
   auto-fetch decision and non-worktree overrides remain, both parked in
   `projects/diff-base/`
4. ~~**Composer paste overflow**~~ — **shipped** (max-height + internal scroll)
5. ~~**Mermaid**~~ — **shipped** (`208bd50ce`). One renderer change lit up chat and the
   file viewer together, per-platform via a webview split

### Unplanned track — editor depth (2026-07-24 → 07-25)

Substantial work that was in **no wave** and is unscored. Recorded here so the plan
reflects what actually happened, and because at least one item would have earned a slot:

- **LSP code intelligence** (`0a8abeb7d`) — supersedes the ctags path behind
  go-to-definition. Impact 4 on the corrected rubric; had it been scored it would have
  led Wave 2 over the shortcut overhaul
- **New Project page** (`0a8abeb7d`)
- **File Editor polish** (`f4f3f5209`, `813a0cb27`) — gutter jump, right-click context
  menu (cut/copy/paste/select all/select line + go to definition), shortcut **hints**,
  hover signature fix

Note the shortcut work in that entry was the _display_ half only (hints). The override
half is Wave 2 item 3, **shipped 2026-07-25** — see below.

### ✅ Wave 2 — supervision and editing feel — COMPLETE (2026-07-25)

The two things you do all day in Otto that currently felt worst. All five shipped, landing
together in `a9714549b` because they shared `protocol/messages.ts`, `session.ts` and
`file-tab-pane.tsx` — concurrent initiatives in one working tree, committed as one sweep
rather than split apart after the fact.

1. ✅ ~~**steer-queue** — stop clobbering a running turn to add a thought~~ —
   **SHIPPED 2026-07-25.** A `delivery: "interrupt" | "queue"` mode on every prompt
   entrypoint (`startAgentRun`), a daemon-owned per-agent FIFO drained in
   `finalizeForegroundTurn` behind a `pendingSteerDrain` hold, and `queuedMessages` on the
   agent snapshot behind `features.steerQueue` (`COMPAT(steerQueue)`, v0.6.8). Provider-neutral
   by construction — it lives in the turn lifecycle above every adapter, so all providers got
   it at once. Absorbed the "queued messages should merge into one send" item: consecutive
   **user** entries are delivered as one turn (system-injected ones never merge). The
   composer's Queue track is now daemon-backed; `Interrupt`/`Queue` were already the
   Settings → Default send labels, so no new vocabulary. Charter drained and folded into
   [docs/chat-lifecycle.md](../../docs/chat-lifecycle.md#delivery--how-a-prompt-reaches-a-busy-agent)
   - [docs/glossary.md](../../docs/glossary.md)
2. ✅ ~~**refine** — the AI rewrite loop with review~~ — **SHIPPED 2026-07-25.** A session
   pins a **set** of files: `documents` may be rewritten and are the request's whole blast
   radius, `references` are read-only context. Diffed against the pinned originals, kept or
   dropped per change, nothing written until Accept (a conditional write per file reporting
   written/stale/failed). Ids not paths cross the wire, so an invented filename cannot
   misroute a write. Provider-agnostic by construction — it resolves through
   `resolveStructuredGenerationProviders({ role: "writer" })`, the chain commit messages and
   chat titles already use. Three deviations from the charter, all deliberate: it is its own
   **job tab** (not a fourth `FileViewMode`), the prompt is composed **daemon-side** (a client
   cannot hand the daemon a prompt it runs verbatim), and `applyRefineDecisions(diff, keptIds)`
   takes the diff rather than the base. Trap 2 discharged: context compaction shipped as two
   rows in `refine-presets.ts`, not a feature.
   **The scope restriction is the load-bearing decision — prose only, never code.** Refine has
   no parser, no symbol table, no language server, so over source it would produce a
   plausible-looking diff that silently breaks a call site — and a plausible diff is exactly
   what gets rubber-stamped. `refine-scope.ts` is the single gate, extension-based on purpose.
   If Refine ever grows symbol awareness, that is the one file that changes
3. ✅ ~~**Keyboard shortcut overhaul** — editor scope that overrides Otto's globals~~ —
   **SHIPPED 2026-07-25.** A "File Editor" registry section, `bindingSpecificity` in the
   matcher (a binding that names the focused surface beats an unscoped one on the same
   combo), and a registry→CM6 bridge so a rebind reaches the open editor. Rules in
   [docs/text-editor.md](../../docs/text-editor.md#keyboard-shortcuts-the-file-editor-scope);
   inventory entry in [remaining-work.md](remaining-work.md#keyboard-shortcuts)
4. ✅ ~~**subagent-liveness 6b/6c** — "alive or hung?" without opening the row~~ —
   **SHIPPED 2026-07-25.** Additive optional `toolUseCount` + `currentTool` on the agent
   snapshot (`COMPAT(subagentLiveness)`), provider-reported for observed rows (Claude reads
   `usage.tool_uses` / `last_tool_name`) and timeline-derived where there is no task report
   (native `create_agent` children, Workflow internal agents). Rendered on the row as
   `elapsed · tokens · N tools · Tool`. Charter drained and folded into
   [docs/chat-lifecycle.md](../../docs/chat-lifecycle.md#the-subagents-track)
5. ✅ ~~**lsp-code-intelligence Phases 2–3**~~ — **OVERSHOT: Phases 1–5 all shipped.**
   Document sync, `code.definition` (LSP-first, ctags demoted to fallback), then hover,
   diagnostics, Find references and Rename — the last two as auditable **job tabs** over a
   shared code-results row vocabulary, with `code.rename.apply` carrying a `planId` rather
   than the edits, so a client cannot rewrite the plan between preview and apply. Phase 4
   (LSP tie-in for the solution model) is the only unbuilt phase, and it belongs to
   `solution-view` now

### Tails Wave 2 left behind

None of these blocks Wave 3. Recorded so they are not rediscovered as bugs.

| Tail                                   | From              | Size | Note                                                                                                                                       |
| -------------------------------------- | ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Refine Phase 4** — Context Mgmt call | refine §14.5      | S    | `openRefineTab({ path, presetId })` from the per-file action. The tab target already carries `presetId`; only the call site is missing     |
| Refine conflict-path test              | refine §10        | S    | The `stale` phase writes nothing on conflict — written and typed, not covered                                                              |
| Refine i18n                            | refine §14.5      | S    | Tab is literal English, like rename/references. Pre-release sweep                                                                          |
| Reorder queued entries                 | steer-queue       | S    | Preview + per-item removal shipped; drag-to-reorder did not                                                                                |
| Claude interrupt receipt               | steer-queue       | S    | SDK ≥ 0.3.212 resolves `query.interrupt()` to `{ still_queued }`, feature-detected via `interrupt_receipt_v1`, currently only debug-logged |
| Keyboard §4 dispatch + §6 audit        | keyboard overhaul | S    | The remaining stage, now much smaller                                                                                                      |

And one that is **not** a tail but a decision, called out separately below.

### 🔵 The decision Wave 2 surfaced — system-injected prompts

Chat @mentions, schedule fires and notify-on-finish still send `delivery: "interrupt"`, so
they clobber a running turn. The steer-queue build identified this as _"arguably a bug and
the strongest correctness argument for the queue"_ — and deliberately left it out of scope,
correctly: flipping it changes behaviour on paths nobody asked to change, and system-injected
entries are the ones that explicitly never merge.

It is a product decision, not a task, and it is cheap once decided. **Take it at the head of
Wave 3**, before the performance work makes the tree noisy.

### Wave 3 — the performance floor, plus three ready things

**Assessed 2026-07-25.** Wave 3 as originally cut was a single open-ended item, and that is
not a runnable wave. Two reasons it needed re-cutting:

- **Its own instrument does not exist.** "No resource reporting at all" is a separate open
  item, and it is the thing that would find the leak. So Wave 3 is really a _chain_ — build
  reporting → measure → find → fix — with an unknown tail, not a task with an end.
- **One item with an unknown tail means the wave can produce nothing.** Every other wave so
  far shipped because it held several independently-completable things.

So the FPS work stays the spine, and three ready items with known ends run beside it. They
were chosen to touch different code: nothing here collides with the profiling work.

1. **System-injected delivery decision** (above). Small, and it is a correctness question
   sitting on machinery that just shipped
2. **App-wide FPS degradation** — the spine. Measurement-first: build the resource
   reporting, then find the leak. Impact 4 — an app that degrades over a long session is
   exactly the failure mode a leave-it-running monitoring tool cannot have. The Visualizer
   staying smooth while the rest degrades points at the JS thread / a leak / daemon
   backpressure, **not** the GPU — that narrows the first measurement
3. **computer-use Phase 0** (openai-compat vision) — _pulled forward from Wave 4._ Scope 2,
   difficulty 2, impact 4: paste a screenshot at a local model and have it see. Its own
   charter says Phase 0 is independently valuable, and it is the cheapest impact-4 item left
   on the board. Pure fork thesis — a capability Claude users have and local-model users
   do not
4. **personality-memory** — _pulled forward from Wave 4._ Impact 4 and compounding: every
   spawn starts from zero today, so the same corrections get re-taught forever. Self-contained,
   and now cheaper than when it was scored — Refine's structured-generation chain and the
   observed-subagent accounting both landed under it

Opportunistic, if the FPS measurement stalls: **Refine Phase 4** (a call site), the
`projects/todos/` remainder, **preview-file-tabs**, **web-search-providers**.

### Wave 4 — provider parity and continuity

Personality-memory and computer-use Phase 0 were pulled forward into Wave 3; what remains
here is the parity block, which is the fork's whole thesis and also its most expensive
sequencing constraint.

1. **upstream merge → subagent convergence → provider adapters** (trap 1, non-negotiable
   order). Impact here is conditional: transformative for OpenCode/Codex/Pi users,
   invisible to Claude users. Sequence it by who your users actually are
2. Shared context instrumentation → visualizer ring + usage-log View B (trap 3)
3. **total-token-accounting** · **history-management** — trust and tidiness
4. **solution-view Phase 1** — the read-only Solution lens (see §3.4). Sits here rather
   than Wave 3 because its impact is provider-shaped in the same way the adapters are:
   a 5 for .NET developers, a 1 for everyone else. Phase 2 (general file mutations) is
   **not** .NET work and enables mutation paths beyond it

### Wave 5 — the big bet

Pick **one** of agent-orchestration or (session-decomposition → mobile-daemon). Both are
quarter-scale and both are strategically defensible; running them concurrently in one
shared working tree is not. Note session-decomposition is an impact-1 refactor that only
makes sense as mobile-daemon's prerequisite (trap 4) — if mobile-daemon is not the pick,
do not do it.

### Deferred indefinitely

multiplayer · visualizer Arena mode · computer-use beyond Phase 0 · bug-reporting
(different user) · git-hosting GitLab (until a GitLab user exists).
