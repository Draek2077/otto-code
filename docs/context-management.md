# Context Management

**Everything a provider sends before you type a word** - resolved into a graph, measured as a share
of the model's context window, and made editable. It answers the question the token ledger cannot:
_what fixed weight am I carrying every single turn, and how do I cut it?_

The division of labour is deliberate.
[subagent-accounting.md § Chat totals](subagent-accounting.md#chat-totals-one-honest-number-per-chat)
owns _"what did this chat cost"_ - spend, which only grows. Context Management owns _occupancy_ -
the fixed tax paid on every request before the conversation starts. They share no units and must
never appear in one readout; see [glossary.md](glossary.md).

Gated by `server_info.features.contextManagement` (`COMPAT(contextManagement)`, v0.6.5) and the
`contextManagement` entry in `features/feature-catalog.ts`.

## The two kinds of edge - the fact everything else rests on

| Edge                                     | Syntax                                       | In the request?                         |
| ---------------------------------------- | -------------------------------------------- | --------------------------------------- |
| **Hard / import** - UI: _"Always load"_  | `@docs/foo.md`                               | **Yes**, inlined recursively at load    |
| **Soft / reference** - UI: _"Link only"_ | `[foo](docs/foo.md)`, or prose naming a path | **No.** Only the link text costs tokens |

Get this wrong and every number is a lie. This repo's own root `CLAUDE.md` links ~45 `docs/*.md`
and ~30 `projects/*.md` files and **loads none of them**. A scanner that treated a markdown link as
a context edge would report several hundred thousand tokens against a true cost of ~6K.

Soft edges are still worth drawing, because they are **read magnets** - a documented invitation for
the agent to pull the file in mid-turn (this repo literally instructs agents to read
`docs/preview.md`). That is not fixed cost; it is _probable_ cost, and it gets its own total and a
dashed edge rather than being folded into the headline.

### Three cost classes

| Class           | When it loads                        | Examples                                                                                                              |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Fixed**       | every request from turn one          | root context files + their imports, memory index, tool schemas, skills roster, system prompt, personality/team prompt |
| **Conditional** | when the agent touches that area     | subdirectory `CLAUDE.md`, skill bodies, recalled memory entries                                                       |
| **Referenced**  | only if the model chooses to read it | soft-linked docs                                                                                                      |

Subdirectory context is **not** start-of-session cost - verified live: reading a file under
`packages/server/` caused the harness to inject `packages/server/CLAUDE.md` mid-session.

### What is actually controllable

The tool claims control only where control exists, which is roughly 80% of the weight.

|                     | Controllable | Lever                                                                                                |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Fixed → conditional | ✅           | flip the edge to _Link only_ (below)                                                                 |
| Fixed → conditional | ✅           | demote a rule into a subdirectory context file (not built - see the ledger)                          |
| Skills roster       | ✅           | disable a skill, **or shorten its description** - the description is the fixed cost, the body is not |
| MCP tool schemas    | ✅           | disable servers per project                                                                          |
| Memory index        | ✅           | compact the index; entries are recalled, not fixed                                                   |
| Referenced → read   | ❌           | you cannot control whether the model reads a link. **The UI says so.**                               |

## The inventory - the root is not "CLAUDE.md"

The tree root is **"Sent before you type"**. Context files are one branch of six
(`ContextCategory`, `agent/context-management/types.ts`):

| Category        | Source                                                                            | Otto's visibility                        |
| --------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| `context_files` | the CLAUDE.md / AGENTS.md graph plus imports                                      | convention scan; exact for openai-compat |
| `memory_index`  | `MEMORY.md` (entries are recalled, **not** fixed)                                 | convention scan                          |
| `skills_roster` | name + description per skill **and per subagent**                                 | filesystem scan                          |
| `mcp_tools`     | tool JSON schemas per connected server                                            | daemon-known                             |
| `otto_injected` | personality prompt, team snapshot, project-knowledge catalog, injected Otto tools | daemon-owned, exact                      |
| `system_prompt` | provider preset                                                                   | opaque for CLIs; exact for openai-compat |

Measuring only markdown was the failure mode this inventory exists to prevent. The fork's own
token-cost audit measured ~9.7–14.9K tok/request for this repo against ~6K `CLAUDE.md` + ~5K
`MEMORY.md` - context files were roughly half, on a workspace with no heavy MCP load. A tool that
trims 3K and barely moves the bill loses the user's trust on its first use.

### An unmeasurable category is a row, not a gap

Zero tokens means two different things - _there is none_ and _Otto cannot see it here_ - and the
first version of this tab rendered both as nothing at all: `categoryTotals` filtered out anything
weighing zero, so the categories no producer ever populated (`system_prompt`, `mcp_tools`) were
indistinguishable from categories that genuinely did not apply. Three of the six advertised
categories were structurally incapable of reporting a number, and the UI said so by staying silent.

Each total therefore carries a `visibility` (`ContextCategoryVisibility`: the three confidence
levels plus `not_visible`), and a `not_visible` category is emitted **even at zero tokens** - that
row is the disclosure. It renders the reason in the slot where every other row puts a figure,
because "0" is a measurement Otto never made and blank reads as "nothing here", which is the one
wrong conclusion available.

The rows still cannot inflate the headline: `not_visible` carries zero by construction, so
`fixedTotal` remains a sum of what was actually measured. `visibility` is optional on the wire
(`COMPAT(contextCategoryVisibility)`) - an older client ignores it and still gets correct totals.

**Roster weight includes plugins.** `resolveSkillRoots` originally covered only the user's and the
project's own skill directories, which on a host with plugins enabled is a small fraction of the
real roster - measured on this machine, 7 entries against a true 13. `plugin-roots.ts` reads
`enabledPlugins` from the provider's settings (local file overriding global), resolves each to its
install directory, and discovers the version segment rather than assuming one: the cache uses the
literal string `unknown` for unversioned plugins. Subagent definitions ride the same category -
they are advertised to the model as a name plus a description exactly as skills are. Both stay on
`skills_roster` deliberately: `ContextCategory` is a `z.enum` travelling daemon→client, so a new
member would make a new daemon's report unparseable by an older client.

The roster remains a **floor**, not an exact figure: skills bundled with the provider's own
application do not live under its config directory, so a convention scan cannot see them. Say that
on screen; do not model around it.

### Per-provider resolution, confidence-tagged

`provider-conventions.ts` is a registry (`getProviderConvention`, `isContextScanSupported`), with
entries for **Claude**, **Codex**, **OpenCode**, **OMP** and the **OpenAI-compatible family**;
anything else reports no scan rather than a guess. Each report carries
`confidence: "exact" | "convention" | "unverified"`, and a convention that has not been
differentially measured must never be presented as fact.

**Not being in the registry is a finding, not a gap.** `pi` is deliberately absent. OMP is a Pi fork
and shares Pi's RPC protocol and `PI_*` environment variables, which makes it tempting to hand Pi
OMP's entry - but OMP is the maximalist fork and its whole discovery pass is exactly the sort of
surface a fork adds. Whether Pi reads `AGENTS.md`, something else, or nothing was never established,
so the tab says it cannot see rather than reporting weight Pi may never send. Same rule as
[the unmeasurable-category one above](#an-unmeasurable-category-is-a-row-not-a-gap): the honest empty
report beats the populated guess.

### OMP: candidates compete for a slot, they do not stack

OMP runs the widest context-file discovery of any provider here. Eleven discovery providers - its
own `.omp/`, plus Claude, Codex, Gemini, OpenCode, Cursor, GitHub, Windsurf, Cline and VS Code -
each nominate a candidate, and all are enabled by default.

They do not stack. Discovery keys a context file by `user` or `project:<depth from cwd>`, and **one
slot holds one file**: the highest-priority provider with a candidate there wins and the rest are
marked shadowed and never sent. That is `ContextLoadPoint.fallbackPaths` exactly, so the entry lists
each slot's spellings in the measured priority order:

| Slot      | Spellings, first hit wins                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Global    | `<omp agent dir>/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md` |
| cwd       | `.omp/AGENTS.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`                      |
| Above cwd | `.omp/AGENTS.md`, `AGENTS.md`                                                                                                   |

Three consequences worth keeping in mind. `.claude/CLAUDE.md` **outranks** the `AGENTS.md` beside it,
which is the order most people would guess backwards. The Claude, Gemini and GitHub candidates exist
only at cwd, because those loaders join their directory onto cwd rather than walking toward the repo
root. And a user who has never opened OMP can still be paying for `~/.claude/CLAUDE.md` on every OMP
request, because OMP adopts another harness's global when it has none of its own.

Nothing below cwd ever loads - the walk only climbs - so OMP has no subdirectory scan root and no
`conditional` rows. `@imports` are inlined recursively, cycle-guarded, capped at depth 5, and skipped
inside fenced and inline code, which is the same treatment the scan gives them.

Confidence is `convention`, not `unverified`: the orders above were established by capturing `omp`
subprocess request payloads verbatim and peeling each slot back one candidate at a time (finding
`omp-pi-instruction-file-discovery`). It cannot be `exact`, because OMP composes the request and a
newer OMP can reorder its providers without Otto knowing. OMP's skills and subagents were **not**
measured, so `skills_roster` stays a floor for OMP the same way it is for the other CLIs.

**openai-compat is the reference provider, not the excluded one.** It is the only provider where
Otto builds the payload itself and therefore knows it exactly - which makes it the ground truth
every convention-based estimate is validated against. (The predecessor charter marked it "not
applicable"; that was backwards.)

Its entry is the only one in the registry that is not a description of a subprocess. The other three
say what Claude, Codex and OpenCode do behind Otto's back; this one is read by
`loadInstructionFiles`, which is what actually builds the prompt. **The scan and the request are two
readings of one resolver**, which is the whole reason its confidence can say `exact`. Change the load
order in `provider-conventions.ts` and you change what the model receives; there is no second list to
keep in step.

**Selection is by capability, never by provider id.** The family has no single id at runtime -
`otto-brain` is one member, and every user-configured endpoint mints an id of its own - so the
adapter's `ownsContextPayload` capability is what routes a provider to this convention and unlocks
the `exact` rows. The predecessor test was `provider === "openai-compat"`, which matched nothing that
runs: no provider is registered under that id, so both exact rows read `not_visible` on every host,
including the one provider Otto measures completely.

### Who loads the instruction files

Every CLI-backed provider reads its own: Claude walks its `CLAUDE.md` chain, Codex and OpenCode
merge `AGENTS.md` from their config directory down to the working directory. The OpenAI-compatible
family has no process of its own to do it, so **the daemon loads them**
(`context-management/instruction-files.ts`, applied at the spawn choke point as
`applyInstructionFiles`).

The gate is `ownsContextPayload`, and it is the correctness argument, not a convenience: loading
these files for a provider that already reads them would send the repo's instructions twice and bill
for both. A provider that composes its own request is left alone.

What gets loaded, in prompt order:

1. `$OTTO_HOME/AGENTS.md` - machine-wide, Otto's own. Deliberately **not** `~/.claude/CLAUDE.md` or
   `~/.codex/AGENTS.md`: silently inheriting another harness's global file imports its token weight
   into sessions the user never pointed at it.
2. `<project root>/AGENTS.md`.
3. Each directory from the project root down to cwd, outermost first, so the most specific
   instructions land last and read as the most authoritative.

At each of those, `AGENTS.md` wins and `CLAUDE.md` is a **per-directory fallback**. One slot, several
spellings: a repo that only ever wrote `CLAUDE.md` still gets its rules, and a repo carrying both
(this one, where `CLAUDE.md` is a single `@AGENTS.md` line) loads `AGENTS.md` once rather than twice.
The mechanism is `ContextLoadPoint.fallbackPaths`; the first candidate that exists takes the slot and
the alternates are never read.

`@imports` are inlined recursively, cycle-guarded and depth-capped, exactly as the scan describes
them. Markdown links are not: they cost their link text, and the model reads the target with a file
tool only if it decides to. Each file is wrapped in an `<instructions path="…">` block, because
imports are appended after their parent rather than spliced in at the `@` token - without the path a
model cannot tell whose rule it is reading, and "the AGENTS.md in `packages/app` says X" is a thing
agents are routinely asked to reason about.

**Files below cwd load conditionally, from the tool loop.** Claude reads a subdirectory `CLAUDE.md`
lazily once the agent touches that subtree, and the daemon now does the same for the payload-owning
family: when a tool call reads, edits or runs something under a directory below cwd, that directory's
`AGENTS.md` (`CLAUDE.md` as the per-directory fallback, same one-slot rule) joins the conversation
once and stays for the session. The scan root is therefore **cwd, not the project root** - everything
above cwd is already fixed weight - which makes the two halves complements: every `conditional` row
the tab shows is a file that can actually arrive, and nothing can arrive that the tab never showed.
`instruction-files.test.ts` pins both directions.

Six decisions carry it, and each one is a way it could have silently broken:

- **The file lands at the round boundary, as its own message.** Not in the tool's result -
  `pruneToolOutputs` truncates aged tool results, so the rules would decay into a
  `[... chars pruned ...]` marker while the model still believed it was following them. Not spliced
  in the moment the tool ran either: that puts a message between an assistant `tool_calls` message
  and its `tool` results, which strict OpenAI-compatible servers reject. After the round's tool
  results and before the next request is built, the conversation is wire-valid and the model sees the
  file on the very next round - the first moment it could act on it anyway.
- **It rides as a user message, never a system one.** A system message is what it is semantically,
  and it is unusable on the wire: Qwen and GLM chat templates raise
  `System message must be at the beginning` from Jinja for any system message after the first turn,
  which llama.cpp returns as a 500 on that request and every one after it. The conversation is
  poisoned for the rest of the session, so the user gets a dead chat rather than a degraded one. The
  framing line above the file carries the meaning the role no longer does, and appending at the tail
  leaves the cached prefix (system prompt, tool catalog, history) intact. Exactly one system message,
  at index 0, is a wire invariant of this provider; `expectSystemMessageOnlyAtHead` pins it.
- **A touched path contributes its whole chain below cwd, outermost first.** Editing
  `packages/app/src/foo.ts` is working under `packages/app` too, and the most specific file lands
  last so it reads as the most authoritative, matching the fixed chain's order.
- **First visit wins, keyed case-insensitively on Windows** (`contextPathKey`, shared with the
  graph). A subtree touched twenty times loads once.
- **Compaction pins them.** A summary of a rules file is not a rules file: an injected file caught in
  the summarize region would come back as a sentence about itself while the model went on believing
  it still had the rules. They are lifted out of both regions and re-inserted verbatim after the
  rebuilt system prompt, summary and ack, next to the retained tail.
- **Rewind un-injects, resume does not.** The conversation is the record: `subtreeInstructionDir` on
  the message is the injection's identity, the already-injected set is rebuilt from `this.messages`
  after every rewrite, and a rewind past an injection makes that subtree loadable again - what is not
  in the conversation is not being followed. A resumed session keeps the marked messages and
  therefore does not inject a second copy; only the persisted system prompt is dropped and rebuilt.
  A conversation written by the build that injected these as system messages comes back **rewritten
  to user role**, not dropped: the rules stay in force mid-task, the poisoned message is gone, and
  the next persistence snapshot heals the file on disk.

**The whole mechanism is switchable per provider.** `"midSessionContextUpdates": false` on the
provider entry, or the **Mid-session context updates** switch in the provider's **Agents** tab, stops
the loop from collecting touched paths at all, so nothing is resolved, read or appended and a tool
call costs one boolean instead of an arguments parse. It defaults to on. The switch exists for a
small local context window, where a few thousand tokens of rules arriving unannounced mid-task cost
more than the rules are worth, and it governs anything the loop wants to add to a conversation after
it starts rather than this loader alone. Providers whose conversation Otto does not own are
unaffected either way: an ACP/CLI provider reads its own instruction files in its own process, and
the spawn-time chain above is gated on `ownsContextPayload` for exactly that reason.

Which directories a tool call touched is answered by
`providers/openai-compat-subtree-instructions.ts`, deliberately shape-agnostic: builtin tools name
their target `path`, Otto and MCP tools have shapes the loop cannot know, and `run_command` hides its
paths in a shell string, so every string argument is split on whitespace and any token carrying a
path separator is a candidate. That test is exact rather than heuristic - a token with no separator
can only name a file in cwd, whose directory holds no conditional weight.

Loading is **runtime-only**, like personality memory and the knowledge catalog: it lands on the
launch config and never on the stored one. Editing `AGENTS.md` therefore reaches the next session
without rewriting any agent record, and the stored prompt stays comparable for the
live-personality-switch ownership check.

### The loader's cache is stamped by mtime, not by a clock

Spawn, resume and reload all re-read the chain, and the scan around those few small files costs about
20ms per session start (the file reads themselves are a fraction of a millisecond; the rest is the
graph work around them). `instruction-files.ts` keeps the resolved text per workspace and revalidates
it by stat-ing every path that fed the answer, which takes about 0.15ms.

Three rules keep that from reverting somebody's rules:

- **Absence is watched too.** `scanContextGraph` reports `absentPaths`, every path it tested and did
  not find, so an `AGENTS.md` appearing where there was none invalidates the entry. Watching only the
  files that did resolve would miss exactly that. Markdown link targets are excluded: a link is never
  inlined, so a file appearing at one changes a finding and not a byte of the prompt.
- **A file written moments ago is not cached at all.** Coarse filesystem timestamps, and writes that
  land mid-scan, both produce an mtime that does not describe the bytes that were read. Both cost
  only a cache miss, which is the direction this cache is allowed to be wrong in.
- **It is not the `ContextManagementService` TTL, deliberately.** That 15 second cache holds a
  report whose inputs include the live prompt and tool schemas, which no file stamp can describe, and
  being slightly behind shows a stale number in a panel. This one holds the bytes that become the
  session's rules, where a stale hit silently reverts an edit. Different value, different inputs,
  different cost of being wrong. What they share is `scanContextGraph`, still the single resolver
  both read through.

The subtree loader is uncached on purpose: a session injects a given directory once and remembers it
in the conversation, so there is no second read to save.

## Severity is a share of the window, never absolute tokens

6K tokens is a rounding error at 1M and a catastrophe at 32K. Otto ships LM Studio as a
first-class citizen, so an absolute threshold is indefensible.

| Level                   | Share of window (per category **and** aggregate) |
| ----------------------- | ------------------------------------------------ |
| `ok` (silent)           | < 10%                                            |
| `notice` (panel only)   | 10–24%                                           |
| `warn` (amber flyout)   | 25–49%                                           |
| `critical` (red flyout) | ≥ 50%, or fixed context exceeds the window       |

`DEFAULT_CONTEXT_THRESHOLDS` in `agent/context-management/evaluator.ts`, overridable through
`MutableDaemonConfig` on the rate-limit/speech hot-reload pattern.

Three rules ride with the percentage:

- **Report working room, not just a share.** Fixed context at 44% means the conversation _and_ the
  response share what is left, so the headline reads _"leaves ~110K of working room"_ next to the
  percentage.
- **Say the caching caveat out loud.** Fixed context is exactly what providers cache - expensive
  once, cheap thereafter. "14K every request" is token-true and cost-misleading, and without the
  caveat the money framing is simply wrong.
- **Never default the window to the largest option.** Presets are 32K / 128K / 200K / 262K / 1M
  plus custom; the picker is a **what-if** (_"evaluate as if running: provider × window"_) and
  defaults to the active agent's model window when known, else **200K**. Defaulting to 1M would
  report "you're fine" to everyone and make the tool useless. _Today nothing populates the real
  model window_ - `WorkspaceContextRuntime.windowTokens` accepts one, but no provider-neutral
  model-window lookup exists, so 200K is what you get.

## The tab: three panes, no sub-tabs

```
┌──────────────────┬────────────────────────────────┐
│ 1. Health summary│                                │
│    + window /    │  3. Viewer / Editor            │
│      provider    │     (the existing file tab)    │
│      picker      │     + context operations       │
├──────────────────┤                                │
│ 2. Context graph │                                │
│    tree          │                                │
└──────────────────┴────────────────────────────────┘
```

`packages/app/src/context-management/` - `panel.tsx`, `summary.tsx`, `graph-tree.tsx`,
`sidebar-tabs.tsx`, `findings-list.tsx`, `store.ts`, `use-context-report.ts`. On a compact form
factor the three panes collapse to a drill-down stack (summary → tree → editor) with back
navigation.

**Pane 3 shows a file or a prompt section, never both.** They are one selection, and whichever was
picked last owns the pane - `use-context-selection.ts` holds that rule because three call sites move
it (the tree, the fix list's reveal, the report re-seed) and each getting the precedence right
independently is how two rows end up highlighted at once.

**The sidebar tab strip spans the width left beside the compaction action** (`stretch`). Three
segments at most - Context, Memory, Issues - so an equal split still fits "Issues (40)".

**Both scope pickers are dropdowns, on one row.** _"Evaluate with"_ (window) and _"Viewing for"_
(personality) share `scope-select.tsx`, which wraps `SelectField` and puts the label
inside the trigger so each control reads as a sentence its value finishes. They started as two
wrapping chip rows and cost four rows of the panel's first screen before a single number appeared -
and the personality row grew without bound, one chip per name the host collects. A dropdown costs
one row whatever the roster does, and it has somewhere to put the search field that a long roster
needs (`SEARCHABLE_ROSTER_SIZE`, currently 8). Anything else that has to be chosen up here goes in
the same row, in the same control - this is the panel's densest screen and it does not get a third
shape.

### Never open on a blank tab

A scan is a filesystem walk of every context file the provider loads plus every markdown file they
link to - measured on this repo, ~220 files / ~1.7 MB and **150–260 ms** in the daemon, with
outliers past 1.5 s under load. That is real work, not a bug to optimise away. The failure it
caused was that the tab spent that time _looking broken_: a muted summary line, "Nothing to show
yet" in the tree, "Pick a file" in the pane - none of which distinguishes **scanning** from
**empty**.

Three rules, enforced in `use-context-report.ts`:

1. **Answers outlive the tab.** Results cache in the store keyed by
   `serverId:workspaceId:provider:windowTokens:personalityId`, so re-opening paints the last answer
   immediately and revalidates behind it. `isLoading` (nothing to show) is exposed separately from
   `isRefreshing` (numbers on screen may still move); only the first blanks anything. They outlive
   the tab, not the app: each server keeps its `MAX_QUERY_REPORTS_PER_SERVER` most recently written
   answers (currently 20) and drops the tail, because a report is a whole context graph and that key
   is a product of five dimensions. A dropped key just scans again like a first open.
2. **The pushed baseline seeds the first open.** The composer already primes a report per
   workspace, so when it was evaluated against the same window the tab starts from it.
3. **Identical scans coalesce.** A module-level in-flight map collapses two panes on one workspace
   - and the throwaway request the tab fires before persisted settings hydrate - into a single
     walk. Only `refresh()` (which follows a write) bypasses it.

A stored `null` is a real answer and must not be papered over with the previous report, and a
failed scan says so. An unexplained empty panel is the one outcome this section exists to prevent.

### The graph is a DAG, not a tree

Four dedup rules, all load-bearing:

1. Every file appears **exactly once**. First visit wins, in load order
   (enterprise → user → project → local → subdirectory).
2. Additional parents render as a dimmed _"also imported by X"_ chip on the same node - never a
   second node.
3. **Cycle detection** (`import_cycle`) and a depth cap matching the provider's (`depth_capped`).
4. **Token totals are deduplicated too.** A file imported twice is sent once; counting it twice
   makes the headline a lie.

Every node carries a **scope badge** (`Global` vs `This project`) because a user editing
`~/.claude/CLAUDE.md` is changing every project on the machine and must know that before, not
after. Cost class is visually distinct; solid edge = always loaded, dashed = link only.

**Do not reuse the sidebar explorer's data source.** Reuse its row primitives and visual language
only. The explorer is filesystem-shaped; this is load-graph-shaped, spans multiple roots outside
the workspace, and carries typed edges - forcing it through `file_explorer_request` fights the
model. Note "roots" is plural: up to five load points can exist at once, so there is no single
root to open to. The pane opens to the highest-impact **project-scoped** file.

**No context file is not an error.** It is the default for every new user, so the empty state is
"Set up your project context" - generate a starter file from the repo through the draft → review →
save path, never an auto-write. Zero → written → trimmed is what makes this a management surface
rather than a nag.

## Prompt sections - reading, never editing

The graph answers _what is loaded_ and _what it costs_. It cannot answer the question users ask
first - **"so what is the model actually reading?"** - because a tree of filenames and token counts
never shows the thing itself. `prompt-preview.ts` assembles the real content.

**It is a row in the tree, not a tab.** Most rows resolve to a file, and clicking one opens it in the
editor; the rows that do not - `otto_injected`, and on openai-compat `system_prompt` and `mcp_tools`

- are prompt text Otto composes at request time, and clicking one opens that text read-only in the
  same pane (`PromptSectionView`). One gesture, one pane, and the answer sits under the row that
  raised the question. A whole-prompt tab was tried first and removed: it stacked every section into
  one 11K wall in which the thing you clicked for was unfindable.

Five rules, all load-bearing:

- **One section per request.** `context.prompt.preview.get` takes an optional `category`, and the app
  always sends it. Reading Otto's injected stack must not re-read every context file on disk to
  build text nobody asked to see - and must not report their tokens either.
- **A prompt row shows the whole stack for that category, and nothing else.** `otto_injected` is the
  system-prompt override, the daemon append (where team and personality role text land) and the
  personality's memory brief, in injection order. The brief is in the row's token total, so leaving
  it out of the text would make the pane and the row above it disagree about one number.
- **Derived, never authoritative.** Sections are re-read from the files the scan resolved, and there
  is **no matching write RPC**. Editing stays per file in the existing pane, against the real file -
  so a stale preview can only be stale, never wrong in a way that lands on disk.
- **Built on `getReport`, not beside it.** The preview shows exactly what the graph counted, under
  the same provider/window/personality what-ifs. Two independent resolutions of "what is loaded"
  would eventually disagree, on screen, about the same request.
- **Fixed weight only, and the roster shows frontmatter only.** Conditional and referenced files are
  not in the request; a skill's body is not either. Rendering either would contradict the token
  figure sitting next to it - which is precisely the misconception this view exists to end.
  `extractFrontmatter` is shared with the scanner so the two can never drift.

**A category Otto cannot see leaves the tree.** `not_visible` with no files under it means the
provider composes that part inside its own process: no number, no text, nothing to expand. On every
CLI-backed provider that is `system_prompt` and `mcp_tools`, and a permanent "not available here"
row is a dead end rather than a disclosure. Where Otto owns the payload (openai-compat) the same two
categories are measurable and readable, and the rows stay. This is the one place the `not_visible`
rule hides a row instead of explaining it - everywhere else the disclosure has a number or a parent
to attach to.

## Operations

### Load mode: Always load ↔ Link only

The single most valuable operation, and the one the whole `sourceRange` design exists for.
`ContextEdge` carries the exact byte range of the reference in its parent, so flipping a hard edge
to a soft one (or back) is a one-line deterministic edit rather than a re-parse. It operates on the
**edge**, not the file - a multi-parent node converts only its own edge - and it runs daemon-side
(`context.edge.convert.request`) because the target may live outside the workspace.

`load-mode-control.tsx` is the control, and two things about it are deliberate:

- **It never says "import".** Users should not have to learn a provider's syntax to control their
  own bill, so the segments read **Always load** / **Link only**, and the token delta is stated up
  front so the choice is informed rather than a leap. On a provider with no import mechanism the
  control is disabled _with the reason_, not hidden.
- **It rides in the file pane's toolbar on desktop** (`toolbar` layout) - a second full-width bar
  cost a row of height to say two words - and falls back to a standalone `strip` on phones, where
  the toolbar has no width to spare.

### Deterministic findings come first

Free, high-confidence, and far more reassuring than asking anyone to trust a model. The shipped
set spans the scanner (`dead_import`, `dead_reference`, `import_cycle`, `depth_capped`) and the
content pass (`content-findings.ts`): `duplicate_across_scope` - rules duplicated between global
and project scope, which is **pure double-billing** and something users almost never know they are
doing - `duplicate_within_file`, and `oversized_memory_entry` (index lines that outgrew the
one-line convention).

**Every finding says where it is.** A finding is stamped with its owning `nodeId` and 1-based
`line`/`lineEnd` as it is created (`finding-location.ts`); the flat report list has no other way to
know, and a row that cannot name its file is a complaint rather than a task. The Issues row is
therefore a jump - it forces the file out of rendered-markdown preview into the editor (a
finding is a request to _edit_, so it overrides the per-file mode memory exactly as the explorer's
"Edit" does), **selects** the offending span via `EditorController.selectLines`, scrolls it to
centre and focuses so one keystroke replaces it, reveals and selects the file's row in the tree,
switches back to the Context tab, and repeats the finding in a banner over the editor so it stays
readable while being fixed. The file comes from `nodeId`, never `relatedNodeIds` - the latter is
the _other_ half of a cross-scope duplicate, which is exactly the confusion the jump exists to end.

The row's leading mark is **scope, not severity**. Everything in the list is already worth fixing,
so the open question is how far the fix reaches. It shares `scope-icon.tsx` with the tree so a file
and a finding about that file are never labelled differently, with one difference: the tree
suppresses `project` as its default-and-therefore-noise case, and the fix list always states it.

Three traps paid for once, worth not re-learning:

- **Taking focus needs persistence, not one call.** `view.focus()` lands when the editor is already
  on screen and loses when it has only just mounted - the click's original target is still being
  torn down and the browser hands focus back to `document.body` _after_ we asked. `editor-core.ts`
  re-asserts focus for ~4 frames, stopping the moment `view.hasFocus` is true so it can never fight
  a user who clicks elsewhere. Relatedly, `handleReady` reveals on _every_ editor mount, not just
  the first: the editor remounts whenever the file changes, so a once-only guard opened the second
  file you jumped to at line 1 with nothing selected.
- **The tree's `scrollToIndex` fires while the FlatList is still mounting** (the reveal is what
  swaps the fix list out for the tree), so it must retry through `onScrollToIndexFailed` or it
  silently never scrolls.
- **Finding ranges are UTF-16 string indices, not byte offsets**, despite the field's name - which
  is why the client is handed line numbers rather than raw offsets to map itself.

### Fix all: mechanical deletes only, no model in the loop

Four of the seven finding kinds have a safe answer a plain delete can give: `dead_import` and
`dead_reference` are just removed, `duplicate_within_file` and `duplicate_across_scope` are a copy
of content that survives elsewhere. `finding-location.ts` stamps that verdict once, centrally, as
`fixable` - every finding also carries a `snippet` (the exact text at `range` when scanned), which
is the staleness guard `context.findings.fix` checks before deleting anything.

`import_cycle` (which edge to cut), `oversized_memory_entry` (where to split it), and
`depth_capped` (nothing to delete at all) stay off the fixable list on purpose - those need
judgment a mechanical pass cannot supply, and shipping a wrong guess there would cost more trust
than leaving the row for a human.

The Issues tab's "Fix all" button (`findings-list.tsx`) sends every fixable finding's
`{filePath, range, snippet}` in one `context.findings.fix.request`. `finding-fix.ts` groups them by
file and deletes back-to-front by range within each file - an earlier deletion never shifts the
offset a later one still needs - verifying each snippet against the file's _current_ contents
first, so an edit made since the scan skips that one finding rather than corrupting the file. A
non-empty `fixedCount` invalidates the report and pushes a fresh one, the same reconciliation
`context.edge.convert` already does.

### Compaction is Refine, not a feature of its own

The requirement was never "a compact button"; it was **a side-by-side diff with per-hunk
accept/reject before anything lands**. For a file whose entire purpose is behavioural rules,
"review the prose that came back" is not enough - the user has to see what got dropped. So
compaction ships as two presets over [Refine](refine.md), and `context-management/refine-action.tsx`
is the call site.

It opens a Refine job with the selected file **rewritable**, the rest of the context graph as
**read-only references** budgeted smallest-first (`refine-reference-budget.ts`, 60 KB / 12 files,
so the seed cannot blow the daemon's per-request ceiling and fail a round the user has no way to
fix), and a preset chosen per file by `presetForContextFile`. Two presets, not one, because an
index and an instruction file fail in opposite directions - an index wants detail moved _out_, an
instruction file wants every rule kept - and one button meaning both would either bloat the index
or quietly drop a rule.

**Compact is a graph action, not a file action**, and that is why it sits left of the
Context/Issues segments (`ContextSidebarTabs`' `leading` slot) rather than in the file toolbar:
Refine in the file toolbar opens the file on screen and nothing else, while Compact opens a job
carrying the whole graph. It renders **disabled** rather than absent when nothing is selected -
that row is chrome the eye returns to, and a control that vanishes reflows the segments beside it.

**Auto-compaction without review is permanently out of scope.**

## Surfacing: the composer flyout is a doorbell

`ContextHealthTrack` (`composer/context-health-track.tsx`) mounts in the composer fly-out stack
immediately above `RateLimitWarningTrack`, so it is topmost in the fan. The warning lives there
rather than in the chat content area to keep two rules clean: suggested tasks stays a content
overlay, and _all warnings come from the composer_.

```
⚠  Project context is 14.2K tokens - 44% of this model's window, every request.   [Manage] [×]
```

- **Amber** = costing you money, nothing is broken (nearly every case). **Red** = actually blocked -
  fixed context exceeds the window, or a required import is missing. It inherits the rate-limit
  track's `approaching`/`rejected` semantics exactly and invents no new ones.
- **One action: `Manage`.** The chip does not open files, offer compaction, or explain the graph.
- **Dismissal is mute-with-key**, bound to severity + size bucket and self-expiring, so an
  escalation mints a new key that breaks through the mute immediately. It is **per-workspace**, not
  per-agent - context health is a property of (workspace, provider), and without that the same
  warning nags on every tab in a project.
- **Dismissal is device-local**, not server-side. It mirrors the proven `rateLimitDismissKey` /
  `mutedUntil` shape in the client store. Server-side sync needs a new persisted daemon store and
  was deferred deliberately.
- **Stack budget:** four flyouts can fan above the composer (context, rate limit, subagents,
  background tasks). Cap at two warning-class flyouts visible; lower-priority ones collapse to a
  count.

## Protocol

Per [rpc-namespacing.md](rpc-namespacing.md); all fields additive and optional per the
back-compat rule.

- `context.report.get.request` / `.response` - carries optional `{ provider, windowTokens }` for
  the what-if pickers.
- `context.edge.convert.request` / `.response` - `{ edgeId, target: "import" | "reference" }`.
- `context_report_changed` - `{ workspaceId, report: ContextReport | null }`, full-report
  reconciliation, mirroring `suggested_tasks_changed`.

There is **no dismiss RPC**: dismissal is device-local, as above.

`ContextReport` carries the nodes, the typed edges, per-category
`{ estTokens, sharePercent, severity }`, the fixed / conditional / referenced totals, the working
room, and the aggregate severity.

## Safety and the estimates

- **Context files use their resolved parent directory as the file-service root.** They commonly live
  outside the workspace (`~/.claude/…`), and editing them is the point of this surface. Project
  ownership does not add a separate warning or permission check.
- **Editing a `global`-scope node confirms first**, naming the consequence: it changes every
  project on the machine.
- **The provider comes from the workspace's newest agent, loaded _or_ persisted.** `listAgents()`
  only sees agents in memory, so a freshly restarted daemon resolved no provider, returned a `null`
  report, and the whole tab read as broken until someone opened a chat. The disk fallback
  (`agentStorage.list()`, newest non-archived agent for the workspace) answers the same question
  without loading anything - only `systemPrompt` survives there, so the injected figure is a
  **floor**.
- **Cache invalidation is a 15 s TTL**, not a `file.watch.*` live re-scan. Converting an edge
  invalidates explicitly and pushes a fresh report; everything else re-reads on the short TTL.
- **MCP tool weight is openai-compat only.** Claude, Codex and OpenCode hand `mcpServers` to a
  subprocess and never expose tool schemas in-process, so that row is exact where Otto owns the
  payload. Honest beats guessed - but honest is not the same as silent, which is why it is
  disclosed rather than dropped (below).
- **Token counts are chars/4.** The differential-measurement calibration (diff a stripped agent's
  turn-one input tokens against a normal agent's; the difference is the real fixed tax) has not
  been run, so the scanner ships convention-first and calibration multiplies in without structural
  change.

## Cross-references

- [refine.md](refine.md) - the propose-then-accept loop compaction runs on
- [token-economy.md](token-economy.md) - the five structural multipliers this measures against
- [glossary.md](glossary.md) - spend vs occupancy, and why they never share a readout
- [agent-profiles.md § Memory](agent-profiles.md#memory-accrued-lessons) - the accrued
  lessons this tab is the one place to see and manage
