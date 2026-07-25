# Charter: Personality memory

**Status:** In build — charter drafted 2026-07-16, **rewritten 2026-07-25** against the product
owner's settled decisions. Everything in §3 onwards supersedes the original sketch; the parts of the
sketch that survive are called out as such, and the parts that were dropped are recorded in §12 with
the reason, because "we considered and rejected it" is the only useful form of a deleted idea.

**Lineage:** Builds on Agent Personalities ([docs/agent-personalities.md](../../docs/agent-personalities.md))
— the named per-host template is the durable identity this feature attaches memory to. Its management
surface is Context Management ([projects/context-management/context-management.md](../context-management/context-management.md)),
which already owns "everything sent before you type".

---

## 1. Why

A personality today is a snapshot: provider/model, effort, mode, prompt, role, colors. Every spawn
starts from zero. But the whole point of naming an agent and giving it a role is continuity — and
continuity without memory is cosmetic.

Concrete motivating cases (user-stated):

- **An orchestrator/planner personality** that watches many runs should be able to note what it
  observes ("the test suite freezes if two workers run vitest concurrently", "worker X is better at
  UI tasks") so the _next_ orchestration starts smarter.
- **A Coder personality** keeps hitting the same mechanism ("Unistyles `useUnistyles()` is forbidden
  here", "this repo's protocol schemas must stay pure") and should be able to remember it instead of
  rediscovering it every session.

---

## 2. The seven settled decisions

These are the product owner's, and they are the spec. Each one is followed by what it forces.

### 2.1 Underneath, these are just stored memories

No exotic representation. A personality accrues **lessons**; they persist per-personality; they are
injected into that personality's context on spawn. That is the whole data model.

> Forces: a flat list of text entries per personality id. No graph, no embeddings, no tiers, no
> per-personality storage-format setting.

### 2.2 Recording must be fire-and-forget

The agent records a lesson without managing any bookkeeping — **no ids to track, no file paths to
choose, no index to maintain.** It states what it learned and the system handles storage, dedup and
placement. If recording is any harder than that, agents will not do it.

> Forces: `remember_lesson(lesson, scope?)` and nothing else on the write path. Dedup is the
> daemon's job, not a discipline in the prompt. The tool never returns an id the agent is expected
> to keep, and never asks where to put anything.

### 2.3 A "review lessons" tool

A tool that reads the accrued lessons back, forms updates, and — **in a session with the user** —
asks clarifying questions and rewrites the lesson based on the answers. This is how lessons improve
rather than accumulate as noise.

> Forces a second, _deliberate_ path with the opposite ergonomics to §2.2: `review_lessons` hands
> out short handles and explicitly instructs the agent to ask before rewriting, and `revise_lesson`
> applies the outcome (rewrite, re-scope, or drop). Recording is reflexive; revising is a
> conversation.

### 2.4 Context Management is THE place to see and manage this

Add a notion of **which personality you are viewing context for** — a selector — because context is
now personality-specific. Memory entries are editable there.

> Rationale (owner's): keeping all context in one place is the whole point of that surface, and
> per-personality editing scattered into personality dialogs would need tooling that does not exist.
>
> Forces: the context report becomes parameterised by `personalityId`; the selected personality's
> memory weight is folded into the report's totals so the percentages stay honest; and the sidebar
> grows a third tab (**Memory**) beside Context and Worth fixing.

### 2.5 Personality dialogs show accrual, not management

A personality dialog surfaces that this personality **has** accrued memory — enough that you would
not delete it casually — but not full CRUD. A deliberate scope limit.

> Forces: a lesson count on the row and in the editor, plus the per-personality on/off switch (a
> switch is not CRUD), and a pointer to Context Management. Nothing that edits an entry.

### 2.6 Memory transfer on delete

Deleting a personality must offer: **delete its lessons, OR transfer them** to another personality
of the user's choice (most likely one of the same role). Accrued knowledge is never silently
destroyed. Required part of the feature, not a follow-up.

> Forces: a delete flow that asks a three-way question (transfer / delete lessons / cancel) whenever
> the personality has any, a destination picker that puts same-role personalities first, and a
> daemon-side transfer that merges into the destination with provenance.

### 2.7 Visibility of injection

The user must be able to see the context injected **specifically for a given personality**. Memory
is only trustworthy if it is inspectable.

> Forces: the daemon returns the **exact brief text** it would inject, not a reconstruction, and the
> Memory tab shows it verbatim with its token cost. The composer is a pure function so the shown
> text and the injected text cannot drift.

---

## 3. Data model

**Daemon-owned, file-based**, per [docs/data-model.md](../../docs/data-model.md): Zod-validated,
atomic writes, no migrations.

```
$OTTO_HOME/personality-memory/<personalityId>.json
```

One file per personality holding an ordered array of entries:

```
PersonalityMemoryEntry {
  id: string                 // machine-generated; NEVER surfaced to a recording agent
  text: string               // the lesson, one short paragraph
  scope: "project" | "global"
  projectRoot?: string       // absolute, set when scope === "project"
  createdAt: string          // ISO
  updatedAt: string          // ISO
  source: "agent" | "user" | "review" | "transfer"
  reinforcedCount?: number   // bumped when a near-duplicate is recorded again
  transferredFrom?: string   // origin personality name, set by §2.6 transfer
}
```

**One file per personality, not one file per fact.** The harness's own `MEMORY.md` + one-file-per-fact
pattern exists because _an agent_ maintains it by hand; here the system maintains it (§2.2), so
splitting across files buys nothing and costs the atomicity that makes transfer-on-delete a single
write. Files stay small by construction: entries are capped (§5).

**Keyed to the personality id, not the agent.** The agent is ephemeral, the personality is the
continuity. The spawn snapshot already carries `personalityId`, so any agent spawned from a
personality reads and writes the same store.

**Scope is resolved, not configured.** This was the sketch's biggest open question. The answer is
_both, automatically_: a lesson defaults to the current project and an agent can mark one
`everywhere`. Injection is `global ∪ thisProject`. That covers both motivating cases from §1 (an
orchestrator's crew observations are host-wide; a coder's gotchas are repo-specific) without asking
anybody to configure a namespace.

---

## 4. The three tools

Registered on the daemon's existing MCP catalog (`otto-tools.ts`), so **every provider gets them at
once** — Claude, Codex, OpenCode, and an openai-compatible local model from LM Studio alike. They
land in the existing `agents` tool group (`ottoToolGroupForName` already routes unprefixed names
there), so the existing per-group allowlist can switch them off; a **new** group value would have
been an enum widening that an old peer could not parse.

| Tool              | Shape                                           | Ergonomics                                                         |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `remember_lesson` | `{ lesson, scope?: "project" \| "everywhere" }` | Fire-and-forget (§2.2). Returns `added` or `reinforced`, no id.    |
| `review_lessons`  | `{}`                                            | Returns every lesson with a short handle + the review protocol.    |
| `revise_lesson`   | `{ handle, lesson?, scope?, drop? }`            | Applies one reviewed outcome. Only reachable via `review_lessons`. |

All three resolve the calling agent's personality from `callerAgentId`; an agent with no personality
gets a clear error ("this agent has no personality, so there is nowhere to keep lessons") rather than
a silent no-op — same posture as `spawn_task` refusing outside an agent session.

`review_lessons`'s description carries the protocol, because the protocol _is_ the feature: read them
back, look for lessons that are stale, too vague to act on, or overlapping; **ask the user about them
rather than guessing**; then call `revise_lesson` per outcome. A model that rewrites without asking
has just laundered its own assumptions into permanent storage.

---

## 5. Injection

**Where:** `AgentManager.prepareSessionConfig` — the one choke point every spawn, resume and refresh
path already funnels through (createAgent, the composer, MCP `create_agent`, schedule runs,
orchestration runs, reattach). One site, provider-agnostic, no per-caller threading.

**Runtime-only, never stored.** The brief is appended to the **launch** config's system prompt and
deliberately not to the stored config, mirroring how `daemonAppendSystemPrompt` is already
"re-derived from daemon settings on resume". Two consequences, both wanted:

1. Memory is **re-read on every resume**, so a lesson recorded yesterday is present today without
   rewriting agent records.
2. The live-personality-switch ownership check (`config.systemPrompt === outgoingComposedPrompt`)
   keeps comparing prompts that have no memory baked in, so it cannot start failing as memory grows.

**Budget.** Hard cap of ~1,500 tokens (`MEMORY_BRIEF_TOKEN_BUDGET`), ordered most-reinforced then
most-recent, and when entries are dropped the brief **says so** and names `review_lessons` as the
fix. A silent truncation would make the injected set differ from the shown set, which is exactly what
§2.7 forbids.

**Not an index + recall.** The sketch proposed injecting a one-line index and loading full facts on
demand. Dropped: the entry set is capped and small, an index costs a second tool plus a round trip
per lookup, and "the agent must decide to recall" is the failure mode this feature exists to remove.
Full text goes in.

**Independent of `respectGlobalAppendPrompt`.** That toggle governs the _daemon-global_ append
prompt. Memory is the personality's own, so a personality that stands alone still gets its lessons.

---

## 6. Protocol

Additive only, per the repo's protocol contract. Feature gate
`server_info.features.personalityMemory`, tagged `COMPAT(personalityMemory)`.

- `AgentPersonality.memoryEnabled?: boolean` — absent means **on**. Cost is zero until a lesson
  exists, so opt-out is the honest default; the toggle exists for a personality you never want
  accruing.
- `personality.memory.list.request` / `.response` — `{ personalityId, projectRoot? }` → entries,
  the **exact brief text**, and its token count (§2.7).
- `personality.memory.update.request` / `.response` — `{ personalityId, entryId?, text?, scope?, drop? }`.
  One write RPC: no `entryId` = add, `drop` = delete. This is the §2.4 editing path.
- `personality.memory.transfer.request` / `.response` — `{ fromPersonalityId, toPersonalityId?, mode }`
  where `mode` is `transfer` or `delete` (§2.6).
- `personality.memory.stats.request` / `.response` — per-personality lesson counts, for the §2.5
  indicator and the selector. Mirrors `agentPersonalities.get_stats`: its own file, no config
  broadcast.
- `context.report.get.request` gains `personalityId?`, and `ContextReport` gains `personalityId?`
  and `personalityMemoryTokens?`.

**No new `ContextCategory` value.** `ContextCategorySchema` is a `z.enum` travelling daemon→client;
adding a member would make a new daemon's report unparseable by an old client. Memory weight folds
into `otto_injected`, which is literally what it is — prompt text Otto composes and injects.

---

## 7. The Context Management surface

The tab already has a summary, a graph tree, a Worth-fixing list and a file editor. Memory adds:

- **A personality selector in the summary.** "Viewing context for: [personality]". Selecting one
  re-requests the report with `personalityId`, so the category bars and the working-room figure
  include that personality's memory. "No personality" is a valid choice and the pre-existing view.
- **A Memory tab in the sidebar**, beside Context and Worth fixing, badged with the lesson count.
  It lists the selected personality's lessons — each editable in place, deletable, with scope shown
  — plus an "Add a lesson" affordance, and above them the **injected brief exactly as the daemon
  composes it**, with its token cost.

Memory is deliberately **not** a node in the graph tree. Tree nodes open in the file pane, and a
lesson is not a file; a row that opens a nonexistent path would be a worse lie than not being there.

### 7.1 Should editing reuse Refine? — No, and here is why

Refine shipped with `compact-context-file` / `compact-memory-index` presets, so the question is fair.
The answer is no, for three reasons:

1. **Refine operates on a set of files** (rewritable documents + read-only references) and diffs
   against pinned originals. A lesson is a JSON row. Reusing Refine would mean materialising memory
   as a temp file, refining it, and parsing it back — inventing a document to satisfy a tool.
2. **The unit is one short paragraph.** Refine's per-hunk keep/drop review earns its complexity on a
   long prose document; on a two-sentence lesson a textarea is strictly better.
3. **The AI improvement path already exists and is better shaped**: §2.3's `review_lessons` is a
   _conversation with the user_, which is what improving a lesson actually requires. Refine's loop
   asks the user to review prose, not to answer questions.

`compact-memory-index` keeps its job — the harness's `MEMORY.md`, which is a file. It is not this.

---

## 8. Personality dialogs (§2.5)

- **Row:** `Used N times · N lessons`. The count is what makes a delete feel consequential.
- **Editor, Identity tab:** a read-only "N lessons remembered — manage them in Context Management"
  line plus the **Remember lessons** switch. No entry list, no editing.

## 9. Delete and transfer (§2.6)

`handleRemove` asks the memory count first. With zero lessons the existing confirm is unchanged. With
any, the confirm becomes a three-way choice:

- **Transfer to…** — a destination picker with **same-role personalities first** (that is the
  overwhelmingly likely intent: you are replacing a Coder with another Coder), then the rest.
  Transferred entries land in the destination stamped `source: "transfer"` and
  `transferredFrom: "<name>"`, and near-duplicates merge rather than double up.
- **Delete the lessons** — explicit, named, destructive.
- **Cancel.**

The transfer runs **before** the roster write, so a failed transfer leaves both the personality and
its lessons intact. Deleting a personality without going through this flow (e.g. an old client
against a new daemon) orphans the file rather than destroying it — the daemon prunes orphans lazily,
never eagerly.

---

## 10. Provider parity

Nothing here is Claude-shaped:

- The tools ride the daemon MCP catalog → every provider at once.
- Injection is at `prepareSessionConfig`, above every provider adapter.
- Any model-assisted step resolves through `resolveStructuredGenerationProviders`, the same chain
  Refine and the mini-tasks use, so a local LM Studio model works identically. (v1 needs no
  daemon-side generation: the review loop runs inside the agent's own session, which is
  provider-neutral by construction.)

---

## 11. Phases

- **Phase 1 — store + brief.** Types, file-backed store with atomic writes and a serialized
  read-modify-write queue, similarity dedup, the pure brief composer, the service facade. Unit
  tested. No wire, no UI.
- **Phase 2 — injection + tools.** `prepareSessionConfig` injection, the live-switch path, the three
  MCP tools, bootstrap wiring.
- **Phase 3 — protocol + RPCs.** Schemas, capability flag, session handlers, client methods, the
  context-report `personalityId` parameter.
- **Phase 4 — Context Management.** Selector + Memory tab + injected-brief display.
- **Phase 5 — personality dialogs + transfer-on-delete.**
- **Phase 6 — fold into docs**, delete this folder.

## 12. Dropped from the sketch, with reasons

| Dropped                                  | Why                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory tiers** (off/simple/structured) | A tier is bookkeeping the user has to think about, which is §2.2's failure mode aimed at the user instead of the agent. One on/off switch, one representation. |
| **Index + `recall`**                     | See §5. Costs a tool and a round trip, and makes remembering conditional on the model choosing to look.                                                        |
| **Editing in the personality editor**    | Explicitly overruled by §2.4 — context belongs in one place, and the editor would need list/diff tooling that surface does not have.                           |
| **Scheduled consolidation pass**         | §2.3's review loop is the consolidation pass, and it asks the user. An unattended rewrite of behavioural rules is the one thing worth never automating.        |
| **Per-team shared memory pool**          | Still out. A team is a selection of personalities, not an identity that learns; if it becomes one, it gets its own store keyed by team id.                     |

## 13. Open questions

- **Cross-personality dedup on transfer** merges by text similarity; a smarter merge (asking the
  destination personality to reconcile two overlapping lessons) is a natural §2.3 extension.
- **Injection budget calibration** — 1,500 tokens is a judgement call against a 200K default window.
  Context Management now _measures_ it, so the number can be tuned with evidence rather than argued.
- **Should a lesson be able to reference a file?** A lesson naming a path is a soft edge in Context
  Management's vocabulary. Not modelled in v1; the text is just text.
