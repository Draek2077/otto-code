# Context Management — charter

> Point-in-time build plan. Supersedes `projects/context-health/context-health.md` (2026-07-18), which
> scoped only "warn about oversized CLAUDE.md." That charter's scanner, protocol and phasing survive;
> its scope, thresholds, action path and surfacing are replaced.
>
> **Identity:** a **Context Management** surface — a one-stop tab where a user sees _everything_ their
> provider sends before they type a word, understands why, and refactors it. **Context Health is the
> summary panel inside it**, not the feature.
>
> **Status: BUILT (uncommitted), 2026-07-19.** Phases 0–3 plus the edge-convert half of Phase 4 are
> implemented end to end: daemon scanner + evaluator, protocol, session RPCs, composer flyout, and the
> three-pane tab. Typecheck and lint clean; 48 daemon + 10 app unit tests green.
>
> Since built: the deterministic content findings (`content-findings.ts`), the load-mode control
> (Always load ↔ Link only, `load-mode-control.tsx`), Codex + OpenCode conventions, a persisted
> window picker, and sidebar project-row entry points.
>
> **Not yet built:** demote-to-subdirectory, skills/MCP toggles, and AI compaction with per-hunk diff.
> The §11 verification (fixture repo + differential measurement) is also still outstanding — the
> scanner ships convention-first, and calibration multiplies in without structural change.
>
> **Why those three are not built, rather than forgotten:**
>
> - **Demote-to-subdirectory** means moving a _rule_ (a span the user chooses) into a subdirectory
>   context file. That is content surgery with no obvious selection model in a read-mostly tree, and
>   the safe version of it is the AI compaction flow, not a one-click button.
> - **Skills / MCP toggles** are each their own subsystem: disabling a skill needs a daemon skill
>   registry with a write path, and MCP toggles need per-project MCP config editing. The report
>   already _measures_ both; turning them off belongs with whichever subsystem owns that config.
> - **AI compaction with per-hunk diff** needs a diff-review surface that AI Refactor itself does not
>   have yet. Adding a `buildContextCompactionPrompt` preset without that review would ship the
>   scariest operation with the weakest safety net, which inverts the §7.5 ordering (deterministic
>   first, AI last).
>
> Decisions locked with the user across three reviews: full-inventory (not just MD files) · % of
> context window (not absolute tokens) · three-pane tab · composer flyout warning · context files get
> an edit-gate exemption.
>
> **Deviations from this charter as built, and why:**
>
> - **Dismissal is device-local**, not server-side (§8). It mirrors the proven `rateLimitDismissKey` /
>   `mutedUntil` shape in the client store, scoped per workspace rather than per agent. Server-side
>   sync needs a new persisted daemon store; deferred deliberately, not forgotten.
> - **Cache invalidation is a 15s TTL**, not the `file.watch.*` live re-scan (§6 of the prior charter).
>   Converting an edge invalidates explicitly and pushes a fresh report; everything else re-reads on a
>   short TTL.
> - **MCP tool weight is openai-compat only.** Claude/Codex/OpenCode hand `mcpServers` to a subprocess
>   and never expose tool schemas in-process, so that row is exact where Otto owns the payload and
>   absent elsewhere — honest rather than guessed.
> - **The provider comes from the workspace's newest agent, loaded _or_ persisted.** `listAgents()`
>   only sees agents in memory, so a freshly restarted daemon resolved no provider, returned a `null`
>   report, and the whole tab read as broken until someone opened a chat. The disk fallback
>   (`agentStorage.list()`, newest non-archived agent for the workspace) answers the same question
>   without loading anything; only `systemPrompt` survives there, so the injected figure is a floor.
> - **The window picker defaults to 200K**, not the active model's real window: no provider-neutral
>   model-window lookup exists yet. The daemon accepts one (`WorkspaceContextRuntime.windowTokens`);
>   nothing populates it.

---

## 1. Mission

Nobody should discover their context bloat on their bill, and nobody should be left in the
"not sure where that is or how to fix this" camp. Otto knows the workspace, the provider and the model.
It should:

1. **Resolve** the full graph of what gets sent before the user types.
2. **Explain** it — what loads always, what loads conditionally, what is merely referenced.
3. **Let the user act** — browse, edit, and run deterministic graph operations that actually reduce it.

This is the visibility half of the token-cost work. `total-token-accounting` owns _"what did this chat
cost."_ Context Management owns _"what fixed weight are you carrying every single turn, and how do I
cut it."_

---

## 2. How context actually loads — the model users need

This section is the feature's intellectual core. Getting it wrong makes every number a lie.

### 2.1 Two kinds of edge

| Edge                                     | Syntax                                       | In the request?                         |
| ---------------------------------------- | -------------------------------------------- | --------------------------------------- |
| **Hard / import** — UI: _"Always load"_  | `@docs/foo.md`                               | **Yes**, inlined recursively at load    |
| **Soft / reference** — UI: _"Link only"_ | `[foo](docs/foo.md)`, or prose naming a path | **No.** Only the link text costs tokens |

**This distinction is load-bearing.** This repo's root `CLAUDE.md` links ~45 `docs/*.md` and ~30
`projects/*.md` files. **None are loaded.** A scanner that treated markdown links as context edges
would report several hundred thousand tokens against a true cost of ~6K.

Soft edges are still worth showing: they are **read magnets** — a documented invitation for the agent
to pull the file in mid-turn (this repo literally instructs agents to read `docs/preview.md`). Not
fixed cost; _probable_ cost. Solid edge vs. dashed edge, counted in separate totals.

### 2.2 Three cost classes

| Class           | When it loads                        | Examples                                                                                                              |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Fixed**       | every request from turn one          | root context files + their imports, memory index, tool schemas, skills roster, system prompt, personality/team prompt |
| **Conditional** | when the agent touches that area     | subdirectory `CLAUDE.md`, skill bodies, recalled memory entries                                                       |
| **Referenced**  | only if the model chooses to read it | soft-linked docs                                                                                                      |

Verified live: reading a file under `packages/server/` caused the harness to inject
`packages/server/CLAUDE.md` mid-session. Subdirectory context is **not** start-of-session cost.

### 2.3 What is actually controllable

|                     | Controllable | Lever                                                                                              |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| Fixed → conditional | ✅           | hard→soft edge conversion (§7.1)                                                                   |
| Fixed → conditional | ✅           | **demote a rule into a subdirectory `CLAUDE.md`** (§7.2)                                           |
| Skills roster       | ✅           | disable skill, **or shorten its description** — the description is the fixed cost, the body is not |
| MCP tool schemas    | ✅           | disable servers per project                                                                        |
| Memory index        | ✅           | compact the index; entries are recalled, not fixed                                                 |
| Referenced → read   | ❌           | cannot control whether the model reads a link. **Say so.**                                         |

~80% is deterministic. The tool claims control only where control exists.

### 2.4 Per-provider resolution (confidence-tagged)

| Provider          | Fixed at start                                                                                             | Imports                                    | Conditional                      | Confidence                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| **Claude Code**   | `~/.claude/CLAUDE.md`, repo `CLAUDE.md`, `CLAUDE.local.md`, enterprise policy, memory index, skills roster | **Yes** — `@path`, recursive, depth-capped | subdir `CLAUDE.md`, skill bodies | High on shape; **verify depth cap + enterprise path** (§11)           |
| **Codex**         | `AGENTS.md` merged cwd→repo root, `$CODEX_HOME/AGENTS.md`                                                  | believed **no**                            | skills                           | Medium — **must verify**                                              |
| **OpenCode**      | `AGENTS.md` + config `instructions` array (**accepts globs**)                                              | via globs                                  | —                                | Medium. Globs make the set genuinely non-obvious → highest value here |
| **Copilot / ACP** | `.github/copilot-instructions.md` + per-agent conventions                                                  | varies                                     | —                                | Low; subprocess-owned. Show as _unverified convention_, never as fact |
| **openai-compat** | no project files — but **Otto's own** system prompt, injected tool catalog, personality/team prompt        | n/a                                        | —                                | **Exact.** Otto builds the payload                                    |

**openai-compat is the reference provider, not the excluded one.** It is the only provider where Otto
knows the payload with certainty — ground truth to validate every other provider's estimates against.
(The prior charter marked it "not applicable"; that was backwards.)

---

## 3. The full inventory — every category of fixed weight

The tree root is **"everything sent before you type"**, not "CLAUDE.md". Context files are one branch.

| Category        | Source                                                 | Otto's visibility                        |
| --------------- | ------------------------------------------------------ | ---------------------------------------- |
| `context_files` | CLAUDE.md / AGENTS.md graph + imports                  | convention scan                          |
| `memory_index`  | `MEMORY.md` (entries are recalled, **not** fixed)      | convention scan                          |
| `skills_roster` | name + description per installed skill                 | filesystem scan                          |
| `mcp_tools`     | tool JSON schemas per connected server                 | **daemon-known**                         |
| `otto_injected` | personality prompt, team snapshot, injected otto tools | **daemon-owned, exact**                  |
| `system_prompt` | provider preset                                        | opaque for CLIs; exact for openai-compat |

For an MCP-heavy user the tool catalog can dwarf CLAUDE.md. The fork's own token-cost audit measured
~9.7–14.9K tok/request for this repo against ~6K CLAUDE.md + ~5K MEMORY.md — context files were roughly
half, without a heavy MCP load. **A tool that only measures MD files will trim 3K, move the bill barely,
and lose the user's trust.**

---

## 4. Evaluation model

### 4.1 Severity is % of window, never absolute tokens

6K tokens is a rounding error at 1M and a catastrophe at 32K. Otto ships LM Studio as a first-class
citizen, so absolute thresholds are indefensible.

| Level                   | Share of window (per category **and** aggregate) |
| ----------------------- | ------------------------------------------------ |
| `ok` (silent)           | < 10%                                            |
| `notice` (panel only)   | 10–24%                                           |
| `warn` (amber flyout)   | 25–49%                                           |
| `critical` (red flyout) | ≥ 50%, or fixed context exceeds the window       |

Configurable via `MutableDaemonConfig` (the rate-limit/speech hot-reload pattern).

### 4.2 Window picker

Presets: **32K** (small local quants — the people who need this most), **128K** (GPT-class, Llama 3.x,
Mistral), **200K** (Claude standard), **262K** (Qwen3/GLM/DeepSeek-class), **1M** (Gemini, Claude 1M
beta, Llama 4 Scout), plus **custom**.

**Default = the active agent's real model window if known, else 200K. Never default to 1M** — defaulting
to the largest window reports "you're fine" to everyone and makes the tool useless.

### 4.3 Report working room, not just a percentage

Fixed context at 44% means the conversation _and_ the response share the rest. Headline copy is
**"leaves ~110K of working room"** alongside the percentage.

### 4.4 Prompt caching caveat

Fixed context is exactly what providers cache — expensive on first request, cheap on repeat. "14K every
request" is token-true but cost-misleading. The summary states this plainly and, where the provider
reports cache hits, reflects it. Without this the money framing is wrong.

### 4.5 Provider picker

Agnostic core, provider-specific resolution. The evaluator is one function over categories; only §2.4
resolution diverges. The picker is a **what-if** — _"evaluate as if running: [provider] [window]"_ —
defaulting to the active agent.

---

## 5. Data model

```
ContextNode {
  id: string
  path: string                 // absolute, daemon-side
  relPath: string              // display, relative to project root or ~
  scope: "global" | "project" | "local" | "enterprise" | "subdirectory"
  category: "context_files" | "memory_index" | "skills_roster" | "mcp_tools"
           | "otto_injected" | "system_prompt"
  costClass: "fixed" | "conditional" | "referenced"
  bytes: number
  estTokens: number
  editable: boolean            // resolveEditGate outcome (§10.2)
  findings: ContextFinding[]   // deterministic issues (§7.5)
}

ContextEdge {
  fromId: string
  toId: string
  kind: "import" | "reference" // hard | soft
  sourceRange: { start: number; end: number }   // byte range in `from` — enables §7.1 conversion
}

ContextReport {
  workspaceId: string
  provider: string
  windowTokens: number         // from picker or active model
  scannedAt: string
  confidence: "exact" | "convention" | "unverified"
  nodes: ContextNode[]
  edges: ContextEdge[]
  categoryTotals: Record<Category, { estTokens: number; sharePercent: number; severity: Severity }>
  fixedTotal: number
  conditionalTotal: number
  referencedTotal: number
  workingRoom: number
  aggregateSeverity: Severity
}
```

Wire schema mirrors this in `packages/protocol/src/messages.ts`, all fields additive/optional per the
back-compat rule.

`sourceRange` on the edge is what makes §7.1 a deterministic edit rather than a re-parse.

---

## 6. The Context Management tab

One module, three parts. No sub-tabs.

```
┌──────────────────┬────────────────────────────────┐
│ 1. Health summary│                                │
│    + window /    │  3. Viewer / Editor            │
│      provider    │     (existing file tab infra)  │
│      picker      │     + context operations       │
├──────────────────┤                                │
│ 2. Context graph │                                │
│    tree          │                                │
└──────────────────┴────────────────────────────────┘
```

### 6.1 Summary (top-left)

Category bars as % of window, working-room figure, aggregate severity, window + provider pickers,
caching note, deterministic-findings count.

### 6.2 Graph tree (bottom-left)

- Root = **"Sent before you type"**; children are the §3 categories; `context_files` expands into the
  file graph.
- **Solid edge = always loaded. Dashed = link only.** Distinct token totals.
- **Scope badge on every node** — `Global` vs `This project`. A user editing `~/.claude/CLAUDE.md`
  is changing every project on the machine and must know before, not after.
- **Cost-class styling** — fixed / conditional / referenced visually distinct.

**Dedup rules (a DAG, not a tree):**

1. Every file appears **exactly once**. First visit wins in load order
   (enterprise → user → project → local → subdirectory).
2. Additional parents render as a dimmed _"also imported by X"_ chip on the same node — never a second node.
3. **Cycle detection** required (A→B→A), plus a depth cap matching the provider's.
4. **Token totals are deduplicated too.** A file imported twice is sent once; counting it twice makes
   the headline number a lie.

**Do not reuse the sidebar explorer's data source.** Reuse its row primitives and visual language only.
The explorer is filesystem-shaped; this is load-graph-shaped, spans multiple roots outside the workspace,
and carries typed edges. Forcing it through `file_explorer_request` will fight the model.

### 6.3 Viewer / editor (right)

The existing unified `file` tab (`file-tab-pane.tsx` / `FileViewModeBar`), plus the §7 operations.

**Opens to the highest-impact project-scoped file.** Note "roots" is plural — up to five load points
can exist simultaneously; there is no single root.

**Empty state is the best part of the feature.** No CLAUDE.md is not an error — it is the default for
every new user, and an opportunity. The right pane becomes **"Set up your project context"**: generate a
starter file from the repo via the safe draft → review → save path, never auto-write. This is what makes
it a _management_ tab rather than a nag: zero → written → trimmed.

### 6.4 Compact form factor

Three panes do not fit a phone. `useIsCompactFormFactor()` collapses to a drill-down stack:
summary → tree → editor, with back navigation. Decided up front, per the platform rules.

---

## 7. Operations — the refactor toolkit

Graph-level, deterministic-first. Every operation reports its delta _before_ it runs
(_"saves 4.2K per request"_), and routes through the existing conditional-write path.

### 7.1 Convert edge: Always load ↔ Link only ↔ Extract to skill

Right-click a tree node. **Never show the words "import" or "hard/soft"** — the menu reads
**Always load** / **Link only** / **Extract to skill**.

Implementation: `ContextEdge.sourceRange` gives the exact byte range in the parent, so conversion is a
single-line edit. Provider-gated (disabled with an explanation where the provider has no import
mechanism). Operates on the **edge**, not the file — a multi-parent node converts only its own edge.

### 7.2 Demote to subdirectory

Move a rule from the root context file into a subdirectory `CLAUDE.md`, converting **fixed → conditional**.
A real, powerful operation that essentially nobody knows exists.

### 7.3 Skills and MCP

Skills: per-skill enable/disable, and **description length** surfaced as the fixed cost
(_"40 skills = 3.1K tokens of descriptions"_). MCP: per-server disable, per-project.

### 7.4 AI compaction — with a real diff

`buildContextCompactionPrompt` alongside the pure, unit-tested `refactor-prompt.ts`. Role-aware
(instruction files stress _"rules are load-bearing, never drop one"_; `MEMORY.md` stresses the
one-line-per-entry convention).

**Requirement, not an implication: a side-by-side diff with per-hunk accept/reject before anything
lands.** For a file whose entire purpose is behavioral rules, "review the prose that came back" is not
enough — the user must see what got dropped. Draft → composer → review → diff → save. No auto-spawn,
no auto-overwrite, ever.

### 7.5 Deterministic findings (no AI, ship first)

Free, high-confidence, and far more reassuring than an LLM rewrite:

- rules duplicated between global and project scope (**pure double-billing**, users almost never know)
- duplicated sections within a file
- dead `@import`s pointing at missing files
- soft links to deleted files
- `MEMORY.md` index lines that have grown past the one-line convention

**Lead with these.** They answer "what exactly do I delete" without asking anyone to trust a model.

**Every finding says where it is.** A finding is stamped with its owning `nodeId` and 1-based `line`/`lineEnd`
as it is created (`finding-location.ts`) — the flat report list has no other way to know, and a row that
cannot name its file is a complaint rather than a task. The "Worth fixing" row is therefore a jump: a
right arrow — revealed on hover on web, permanent on touch and compact — leaves you ready to fix the
thing: it forces the file out of rendered-markdown preview into the editor (a finding is a request to
edit, so it overrides the per-file mode memory exactly as the explorer's "Edit" does), **selects** the
offending span via the new `EditorController.selectLines`, scrolls it to centre and focuses — one
keystroke replaces it — reveals and selects the file's row in the Context tree, switches back to the
Context tab, and repeats the finding in a banner over the editor so it stays readable while being
fixed. Note the file comes from `nodeId`, never `relatedNodeIds` — the latter is the _other_ half of a
cross-scope duplicate, which is exactly the confusion the arrow exists to end.

The row's leading mark is **scope, not severity** — everything in this list is already worth fixing, so
the open question is how far the fix reaches: a global file is every project on the machine, a project
file is only this one. It uses the tree's own icon vocabulary (`scope-icon.tsx`, shared by both, so a
file and a finding about that file are never labelled differently) with one difference: the tree
suppresses `project` as its default-and-therefore-noise case, the fix list always states it.

**Taking focus needs persistence, not one call.** `view.focus()` lands when the editor is already on
screen and loses when it has only just mounted — the click's original target is still being torn down,
and the browser hands focus back to `document.body` _after_ we asked. `editor-core.ts` therefore
re-asserts focus for ~4 frames, stopping the moment `view.hasFocus` is true, so it can never fight a
user who clicks elsewhere. Related: `handleReady` reveals on _every_ editor mount, not just the first —
the editor remounts whenever the file changes, so a once-only guard opened the second file you jumped
to at line 1 with nothing selected.

Two traps, both paid for once: the tree's `scrollToIndex` fires while the FlatList is still mounting
(the reveal is what swaps the fix list out for the tree), so it must retry through
`onScrollToIndexFailed` or it silently never scrolls; and finding ranges are **UTF-16 string indices**,
not byte offsets, despite the field's name — which is why the client is handed line numbers rather than
raw offsets to map itself.

---

## 8. Surfacing — the composer flyout

The warning lives in the **composer fly-out stack**, not the chat content area — so suggested-tasks stays
a content overlay and _all warnings come from the composer_ stays a consistent rule.

`ContextHealthTrack` mounts **immediately above `RateLimitWarningTrack`** in
`agent-panel.tsx:~1647`, making it topmost in the fan and painted furthest back — "behind usage warnings,
even more topmost." The card shape (`borderBottomWidth: 0`, negative `marginBottom`) comes free from the
documented idiom at `composer/rate-limit-warning-track.tsx:22-28`.

```
⚠  Project context is 14.2K tokens — 44% of this model's window, every request.   [Manage] [×]
```

- **Amber** = costing you money, nothing is broken (≈ all cases).
  **Red** = actually blocked — fixed context exceeds the window, or a required import is missing.
  Inherits the rate-limit track's `approaching`/`rejected` semantics exactly; does not invent new ones.
- **One action: `Manage`** → opens the Context Management tab. The chip does not open files, does not
  offer compaction, does not explain the graph. It is a doorbell.
- **Dismissal = mute-with-key**, copied from `rateLimitDismissKey` / `mutedUntil`: bound to severity +
  size bucket, self-expiring, and an escalation produces a new key that **breaks through the mute
  immediately**. Requires the same `setTimeout(tick, mutedUntil)` re-render trick.
- **Per-workspace mute**, not per-agent — context health is per (workspace, provider); without this the
  same warning nags on every tab in a project.
- **Stack budget:** four flyouts can now fan above the composer (context, rate limit, subagents,
  background tasks). Cap at two warning-class flyouts visible; lower-priority collapse to a count.

**Do not copy the existing hardcoded `WARNING_COLOR`/`REJECTED_COLOR` hex constants**
(`rate-limit-warning-track.tsx:184-185`) — they can drift from the theme between light and dark. Use
`theme.colors.statusWarning` / `statusDanger` throughout, and fix the two lines in the existing track.

---

## 9. Protocol

Per [rpc-namespacing.md](../../docs/rpc-namespacing.md).

- **Feature gate:** `serverInfo.features.contextManagement: z.boolean().optional()` with
  `// COMPAT(contextManagement): added in vX.Y, drop the gate when floor >= vX.Y`.
- **Push:** `context_report_changed` — `{ workspaceId, report: ContextReport | null }`, full-report
  reconciliation, mirroring `suggested_tasks_changed`. Internal daemon event translated in `session.ts`
  next to the suggested-tasks translation.
- **RPCs:**
  - `context.report.get.request` / `.response` — with optional `{ provider, windowTokens }` for the
    what-if pickers (§4.5).
  - `context.report.dismiss.request` / `.response` — `{ workspaceId, key }`.
  - `context.edge.convert.request` / `.response` — `{ edgeId, target: "import" | "reference" | "skill" }`.
    Server-side because it is a byte-range edit against a possibly-outside-workspace file.

---

## 10. Gating and safety

### 10.1 Feature flag

`contextManagement` in `features/feature-catalog.ts` + a `contextWarningsEnabled` setting mirroring
`rateLimitWarningsEnabled`. Plain gated render for the flyout; the tab is a lazy-split panel per
[feature-flags.md](../../docs/feature-flags.md).

### 10.2 Edit-gate exemption **(decided)**

Context files live outside the workspace root (`~/.claude/...`), which the gated-multi-root
`resolveEditGate` free/other/outside logic would block. **The resolved context set gets a standing
exemption** — "outside the workspace" is the entire point of this feature. Scoped to files the scanner
resolved, never a blanket unlock.

### 10.3 Global-scope edits confirm

Editing a `global`-scope node changes **every project on the machine**. Requires an explicit confirm
naming that consequence.

---

## 11. Verify before encoding conventions

Rather than encoding docs and hoping — and given we are about to show a number and ask people to act on it:

1. **Differential measurement.** `providers/claude/agent.ts:1616` already supports a stripped agent
   (`settingSources: []`, no `claude_code` preset, no tools). Diff its turn-one input tokens against a
   normal agent: **the difference is the real fixed tax**, measured per provider. Calibrates chars/4
   instead of shipping a guess.
2. **Fixture repo.** Hard `@import`, markdown link, subdirectory CLAUDE.md, a cycle, a duplicate import.
   Run each CLI against it; record what actually arrives. Becomes a permanent regression test for when a
   CLI changes behavior under us.
3. **Confirm duplicate-import dedup** per CLI (§6.2 rule 4 depends on it).

~half a day, and it converts the whole feature from "best-effort per convention" to "measured, with
conventions as fallback."

---

## 12. Phases

- **Phase 0 — verification + scanner core.** §11 fixture + differential measurement. Then
  `context-graph-scanner.ts` + `provider-conventions.ts` (**a registry from day one**, Claude as its
  single entry — per the fork's provider-agnostic-first rule). Resolves nodes + typed edges + cost
  classes, dedup, cycle detection. Pure, unit-tested. No wire, no UI.
- **Phase 1 — inventory + evaluation.** Remaining §3 categories (skills roster, MCP schemas, otto
  injections, memory index) + the §4 evaluator (% of window, working room). openai-compat wired as the
  exact-ground-truth reference.
- **Phase 2 — protocol + flyout.** Wire schema, feature gate, `context_report_changed`, session
  translation, store slice, `ContextHealthTrack` with mute-with-key. End-to-end: bloat this repo's
  CLAUDE.md → flyout appears → `Manage` is inert until Phase 3.
- **Phase 3 — the tab.** Three panes, graph tree with dedup/scope/cost-class, editor pane, empty-state
  creation flow, compact drill-down, edit-gate exemption.
- **Phase 4 — operations.** Deterministic findings (§7.5) **first**, then edge conversion (§7.1),
  demote-to-subdirectory (§7.2), skills/MCP toggles (§7.3), AI compaction with per-hunk diff (§7.4).
- **Phase 5 — other providers.** Codex, OpenCode, ACP-unverified copy. The registry grows; nothing else changes.

Ship Phases 0–4 as the proof, per "single-provider as proof, not finish line."

---

## 13. Testing

- Scanner: pure unit tests over a temp fixture tree — multi-root, hard + soft edges, a cycle, a
  double-import (asserting single listing **and** single counting), subdirectory file. Style follows
  `refactor-prompt.test.ts` / `workspace-files-session.test.ts`.
- Evaluator: pure unit tests — same byte totals at 32K vs 1M produce different severities.
- Edge conversion: fixture file in, byte-exact file out, both directions, idempotent.
- `buildContextCompactionPrompt`: pure unit test (scope guard, role clauses).
- Protocol round-trip via the ad-hoc daemon harness.
- Back-compat: old client parses the new feature flag/notification; old daemon (no flag) → tab and
  flyout both hidden.
- Per the repo rule: run only the changed file, `npx vitest run <file> --bail=1`.

---

## 14. Open questions

- **Where the tab lives** — workspace-level tab vs. its own screen. Leaning workspace tab (it is
  per-workspace + provider).
- **Deep/glob import graphs** — v1 does full recursion with a depth cap; OpenCode's config globs may
  need special handling.
- **Cache-aware cost display** — how far to go beyond a caveat (§4.4) depends on what providers report.
- **Cross-device dismissal sync** — server-side from v1 per the multi-device product; confirm the store.
- **Real tokenization** — stays chars/4, calibrated by §11.1. Revisit only if the estimate misleads.
- **Auto-compaction without review** — explicitly **out**, permanently.

---

## 15. File-touch map

**Daemon**

- `packages/server/src/server/agent/context-management/context-graph-scanner.ts` — **new**
- `packages/server/src/server/agent/context-management/provider-conventions.ts` — **new**, registry
- `packages/server/src/server/agent/context-management/evaluator.ts` — **new**, §4
- `packages/server/src/server/agent/context-management/edge-convert.ts` — **new**, §7.1
- `packages/server/src/server/agent/context-composition.ts:11` — reuse `estimateTokens`
- `packages/server/src/server/workspace-registry.ts` + `workspace-git-service.ts:172` — walk roots
- `packages/server/src/server/session.ts:~1369` — event → `context_report_changed`
- `packages/server/src/server/session/files/workspace-files-session.ts` — `file.watch.*` live re-scan
- `packages/server/src/server/websocket-server.ts:~1372` — advertise the feature

**Protocol**

- `packages/protocol/src/messages.ts` — `ContextNode/Edge/ReportSchema`, `context_report_changed`,
  `context.report.*` + `context.edge.convert.*`, `features.contextManagement` (COMPAT-tagged)

**App**

- `packages/app/src/context-management/` — **new**: `tab.tsx`, `summary.tsx`, `graph-tree.tsx`,
  `operations.ts`, `select.ts`
- `packages/app/src/composer/context-health-track.tsx` — **new**, §8
- `packages/app/src/panels/agent-panel.tsx:~1647` — mount **above** `RateLimitWarningTrack`
- `packages/app/src/composer/rate-limit-warning-track.tsx:184-185` — replace hex constants with theme tokens
- `packages/app/src/stores/session-store.ts` — `contextReport` slice + mute-with-key
- `packages/app/src/contexts/session-context.tsx` — `client.on("context_report_changed", …)`
- `packages/app/src/editor/refactor-prompt.ts` + `refactor-dialog.tsx` + `use-ai-refactor.ts` —
  compaction preset + per-hunk diff review
- `packages/app/src/features/feature-catalog.ts` + settings section
