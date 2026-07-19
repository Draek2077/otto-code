# WP · Otto tool catalog — language & bulk review (findings)

> Deliverable for [wp-catalog-language-review.md](wp-catalog-language-review.md). Parent
> accounting: [projects/token-cost-audit/token-cost-audit.md](../token-cost-audit/token-cost-audit.md).
> Measured 2026-07-18. **Nothing here is committed.** The non-controversial tightenings in
> §6 were applied to the working tree; the browser block (§5) is left for WP-C.

## 0. TL;DR

- The catalog's addressable waste is **not** evenly spread. Three buckets hold almost all of it:
  1. **`create_agent` schema** — one tool, **1,480 tok** (5,489 B of it schema), from nested
     discriminated unions. Mostly load-bearing structure; ~200 tok of it is trimmable prose.
  2. **The browser block** — 26 tools repeat two boilerplate sentences (a browserId clause and a
     ref-expiry clause) verbatim. **~230 tok of pure repetition**, safe to shorten but **not** safe
     to delete (MCP providers get no workflow prompt — see §5). Owned by **WP-C**.
  3. **The shared `EFFORT_INPUT_DESCRIPTION` string** — one 196-char sentence inlined into **7**
     tools = **~340 tok**, trimmable to ~240 by shortening the source constant once.
- **Applied now (§6):** shortened the effort constant, `create_agent`/`create_artifact` prose, the
  worktree-target union describes (serialized twice), `spawn_task`/`dismiss_task`/`list_personalities`,
  and `preview_start` prose. **Measured catalog drop: 49,106 → 47,759 B (−1,347 B ≈ −337 tok, −2.7%)**
  at agent scope with browser+preview on.
- **Proposed for WP-C (§5):** browser boilerplate shortening — a further **~900 B ≈ ~225 tok**.
- **Not touched (with reasons):** tool `title` fields (~316 tok, MCP-path only, UI-coupled), the
  `create_agent` union _structure_ (that IS the feature surface), and the `maximum: 9007199254740991`
  integer-bound noise (a `z.toJSONSchema` artifact, ~55 tok — serialization, hand to WP-C).

## 1. Method (re-measured, not trusted blindly)

Two harnesses, agreeing:

1. **Checked-in** `packages/server/scripts/measure-agent-tools-context.ts` — a real MCP
   `tools/list` round-trip against `createAgentMcpServer`, compact-JSON bytes ÷ 4. This is the
   number the audit quoted. It does **not** register preview or personality tools (their deps
   aren't stubbed), so it reports **67 tools / 13,470 tok** browser-on.
2. **This review's harness** — instantiates `createOttoToolCatalog` directly and serializes each
   tool exactly as the openai-compat path does (`ottoToolParameters` → `z.toJSONSchema`, `$schema`
   stripped), i.e. the `{name, description, parameters}` the model actually receives. Preview +
   personality deps stubbed, so it reports the **full 72 tools**. Per-tool figures below are from
   this harness (name + title + description + schema bytes, compact).

**Why the totals differ from the audit's 14.9K.** The audit measured the MCP envelope (adds
`title`, `outputSchema`, `annotations`, `_meta`, and — for Claude — an `mcp__otto__` name prefix,
+814 B). The openai-compat payload carries only `name` + `description` + `parameters` — **`title`
is dropped on that path** (`openai-compat-agent.ts:2056-2063`). Both are "the catalog"; they just
bill different providers. Headline numbers here are the openai-compat form (leaner, more universal):

| Configuration (agent scope)                        | Tools |  Bytes |    ~Tokens |
| -------------------------------------------------- | ----: | -----: | ---------: |
| Full catalog, browser + preview + personalities on |    72 | 49,106 | **12,277** |
| — of which tool `title` (free on openai-compat)    |     — |  1,266 |        316 |
| — of which `description` prose                     |     — | 14,965 |      3,741 |
| — of which serialized input `schema`               |     — | 31,825 |  **7,956** |
| — of which tool `name`                             |     — |  1,050 |        263 |

Schema is 65% of the payload; description 30%. **The schema half is where the tokens are, and most
of it is structural (property names, `type`, `required`, `additionalProperties`) — not reducible
without dropping features. The reducible schema tokens are the embedded `.describe()` prose.**

## 2. Ranked per-tool table (agent scope, openai-compat serialization)

`desc` and `schema` are byte counts of that tool's description string and its serialized JSON Schema
(which itself contains `.describe()` prose). Sorted worst-first. Full 72 rows; top 40 shown.

|   # | tool                  | name | title | desc | schema | total B | ~tok | classify                       |
| --: | --------------------- | ---: | ----: | ---: | -----: | ------: | ---: | ------------------------------ |
|   1 | create_agent          |   12 |    12 |  405 |   5489 |    5918 | 1480 | structure=LB; prose=trim       |
|   2 | create_artifact       |   15 |    15 |  593 |   1713 |    2336 |  584 | trim                           |
|   3 | update_schedule       |   15 |    15 |   95 |   1874 |    1999 |  500 | schema=LB (15 optional fields) |
|   4 | spawn_task            |   10 |    14 |  756 |    828 |    1608 |  402 | trim                           |
|   5 | create_worktree       |   15 |    15 |  116 |   1450 |    1596 |  399 | shared union → trim            |
|   6 | create_schedule       |   15 |    15 |   70 |   1196 |    1296 |  324 | schema=LB                      |
|   7 | update_artifact       |   15 |    15 |  185 |   1016 |    1231 |  308 | LB                             |
|   8 | browser_resize        |   14 |    23 |  463 |    725 |    1225 |  307 | boilerplate (WP-C)             |
|   9 | browser_screenshot    |   18 |    26 |  642 |    452 |    1138 |  285 | trim + boilerplate             |
|  10 | browser_inspect       |   15 |    23 |  449 |    648 |    1135 |  284 | boilerplate (WP-C)             |
|  11 | update_agent          |   12 |    12 |   54 |   1056 |    1134 |  284 | LB                             |
|  12 | preview_start         |   13 |    24 |  902 |    173 |    1112 |  278 | guardrail; light trim          |
|  13 | browser_network       |   15 |    31 |  517 |    511 |    1074 |  269 | boilerplate (WP-C)             |
|  14 | inspect_provider      |   16 |    16 |  141 |    813 |     986 |  247 | LB                             |
|  15 | respond_to_permission |   21 |    21 |   94 |    799 |     935 |  234 | LB                             |
|  16 | list_personalities    |   18 |    18 |  538 |    316 |     890 |  223 | trim                           |
|  17 | browser_page_text     |   17 |    22 |  439 |    373 |     851 |  213 | trim + boilerplate             |
|  18 | send_agent_prompt     |   17 |    17 |  117 |    693 |     844 |  211 | LB                             |
|  19 | preview_logs          |   12 |    28 |  256 |    473 |     769 |  193 | LB                             |
|  20 | browser_click         |   13 |    21 |  260 |    474 |     768 |  192 | boilerplate (WP-C)             |
|  21 | browser_upload        |   14 |    23 |  279 |    380 |     696 |  174 | boilerplate (WP-C)             |
|  22 | browser_evaluate      |   16 |    27 |  304 |    334 |     681 |  171 | boilerplate (WP-C)             |
|  23 | dismiss_task          |   12 |    24 |  417 |    220 |     673 |  169 | trim                           |
|  24 | browser_drag          |   12 |    20 |  273 |    361 |     666 |  167 | boilerplate (WP-C)             |
|  25 | browser_wait          |   12 |    26 |  245 |    380 |     663 |  166 | boilerplate (WP-C)             |
|  26 | browser_scroll        |   14 |    14 |  281 |    352 |     661 |  166 | boilerplate (WP-C)             |
|  27 | browser_keypress      |   16 |    17 |  302 |    324 |     659 |  165 | boilerplate (WP-C)             |
|  28 | browser_type          |   12 |    17 |  296 |    312 |     637 |  160 | boilerplate (WP-C)             |
|  29 | browser_select        |   14 |    21 |  275 |    320 |     630 |  158 | boilerplate (WP-C)             |
|  30 | browser_fill          |   12 |    20 |  270 |    320 |     622 |  156 | boilerplate (WP-C)             |
|  31 | browser_focus_tab     |   17 |    17 |  336 |    235 |     605 |  152 | boilerplate (WP-C)             |
|  32 | browser_hover         |   13 |    21 |  260 |    286 |     580 |  145 | boilerplate (WP-C)             |
|  33 | browser_logs          |   12 |    17 |  247 |    302 |     578 |  145 | boilerplate (WP-C)             |
|  34 | browser_new_tab       |   15 |    18 |  488 |     33 |     554 |  139 | trim + guardrail               |
|  35 | browser_snapshot      |   16 |    21 |  276 |    235 |     548 |  137 | boilerplate (WP-C)             |
|  36 | create_heartbeat      |   16 |    16 |   71 |    429 |     532 |  133 | LB                             |
|  37 | list_agents           |   11 |    11 |   39 |    457 |     518 |  130 | LB                             |
|  38 | browser_close_tab     |   17 |    17 |  234 |    235 |     503 |  126 | boilerplate (WP-C)             |
|  39 | rename_workspace      |   16 |    16 |  104 |    297 |     433 |  109 | LB                             |
|  40 | wait_for_agents       |   15 |    15 |  164 |    238 |     432 |  108 | LB                             |

(Rows 41–72 are all ≤107 tok — mostly single-`id` schedule/terminal/worktree verbs whose schema is
just `{id: string}` plus the `additionalProperties:false` envelope. Nothing reducible without
touching structure; `title` duplicating `name` is the only fat, addressed in §7.)

Classification key: **LB** = load-bearing (changes model behavior or is a real guardrail — keep);
**trim** = clarifying but over-written; **boilerplate** = verbatim repetition across tools.

## 3. The `create_agent` whale (1,480 tok)

Serialized schema is 5,489 B. Anatomy:

- **Structure (~4,600 B, keep):** `relationship` union (2 branches) + `workspace` union (3 branches,
  one nesting a `source` union of 2, one of which nests a `target` union of 3). This is the literal
  feature surface — subagent/detached × current/existing/create × directory/worktree ×
  branch-off/checkout-branch/checkout-pr. `z.toJSONSchema` emits each branch as a full object with
  its own `additionalProperties:false` and `required` array; that repetition is unavoidable in JSON
  Schema without collapsing features. **Do not restructure.**
- **Prose (~900 B, ~200 tok, trimmable):** the tool description (405 B) + the `personality` field
  describe (470 B) + the three worktree-branch describes ("… in a new Otto worktree." ×3). Trimmed
  in §6.
- **Note:** at **agent scope** (`callerAgentId` set) `create_agent` does **not** carry the 9 legacy
  top-level fields — those only appear on the top-level (client) variant. So the audit's "9 legacy
  duplicate fields" bulk is a _top-level-only_ cost (7,243 B variant), not paid on agent-to-agent
  spawns. See §4.

## 4. The 9 legacy `create_agent` fields (top-level variant, back-compat)

`cwd, mode, thinking, features, worktreeName, branchName, baseBranch, refName, githubPrNumber` —
each `.optional()` with a "Legacy X. Prefer Y." describe (`otto-tools.ts:1456-1498`). They serialize
only on the **top-level** (non-agent) `create_agent`, adding ~1,200 B there. Per the brief and
CLAUDE.md protocol rule, the **fields** can't be dropped without a dated `COMPAT(...)` tag and a
confirmed floor-version cleanup. **Cheapest safe win: trim their describe text**, e.g.
`"Legacy worktree slug. Prefer workspace.source.target.worktreeSlug."` →
`"Legacy; prefer workspace.source.target.worktreeSlug."` (drops the redundant restatement of the
field's own name) — ~15 B × 9 ≈ 135 B on the top-level path. Left as a **proposal** (top-level
path only, low traffic; not worth risking a describe that helps old clients migrate). If/when the
client floor moves past these, a single `COMPAT(createAgentLegacyTopLevel)` removal reclaims the
full ~1,200 B.

## 5. The browser block — proposed for WP-C (do NOT double-apply)

26 browser tools (`browser-tools/tools.ts`) repeat two sentences **verbatim**:

- **browserId clause**, two forms:
  - long (123 ch), in ~15 tools: `"Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing"`
  - short (68 ch), in 5 tools: `"Use browserId from preview_start, browser_new_tab, or browser_list_tabs."`
- **ref-expiry clause** (90 ch), in ~12 tools:
  `"refs come from the latest browser_snapshot of the same tab and expire when the page changes"`

Repetition cost ≈ **920 B ≈ 230 tok** across the block.

**Hard constraint (from [docs/preview.md](../../docs/preview.md):66-89):** "Descriptions steer, the
daemon enforces" — the preview-tab redirect and workspace-context checks are enforced server-side
(`findPreviewServerForUrl`, `requireWorkspaceContext`), so the _guardrail_ survives wording changes.
**But** preview.md:88 warns that MCP providers (Claude, Codex, …) "get the guardrail-bearing tool
descriptions but no injected workflow prompt." So the boilerplate **cannot** simply be "stated once
in the workflow prompt" — that only reaches openai-compat. For the MCP majority it must stay
in-description. **Recommendation for WP-C:**

1. **Collapse both clauses to their short forms in every browser tool** (safe for all providers,
   keeps steering). Standardize the browserId clause to the 68-ch short form; shorten ref-expiry to
   `"refs are from the latest browser_snapshot and expire on navigation."` (65 ch). Est. **−900 B**.
2. **Then** (separately) add a one-line browser preamble to the MCP-provider system prompt so even
   the short in-description clause can eventually shrink to `"browserId: see preview_start / browser_list_tabs."` — that's the real single-source-of-truth, and it's the infra half WP-C owns.

Concrete per-tool short-form language is mechanical from the two strings above; no unique-action
wording changes. I did **not** edit `browser-tools/tools.ts` to avoid colliding with WP-C's dedup pass.

One browser description also has a genuine **trim** independent of boilerplate: `browser_screenshot`
(642 B) over-explains the fullPage/ref/zoom trichotomy in prose that the schema already encodes —
can lose ~120 B without losing steer. Flagged for WP-C alongside the dedup.

## 6. Applied tightenings (working tree, uncommitted)

All in `packages/server/src/server/agent/tools/otto-tools.ts` unless noted. Meaning and every
feature preserved; only prose shortened.

### 6.1 `EFFORT_INPUT_DESCRIPTION` constant — inlined into 7 tools

- **Before (196 ch):** `Effort: a canonical level (off, minimal, low, medium, high, xhigh, max), resolved to the nearest option the target model supports, or an exact option id from the model's thinkingOptions in list_models.`
- **After (137 ch):** `Effort level (off/minimal/low/medium/high/xhigh/max), clamped to the model's nearest option, or an exact thinkingOptions id from list_models.`
- **Saving:** 59 B × 7 uses (create_agent.settings, update_agent, update_schedule, create_schedule,
  create_artifact, update_artifact, and the inspect_provider draft echo) ≈ **~413 B / ~103 tok** — the
  single highest-leverage word change in the catalog.

### 6.2 `create_agent` description

- **Before (405 B):** `Create an agent. Requires relationship, workspace, and either a provider/model (for example codex/gpt-5.4) or a personality name. Title and initialPrompt are optional — omit both to just open a new chat that greets the user and asks what to work on. Prefer a personality when the host has them (call list_personalities). Do not guess the provider; call list_providers and list_models first if uncertain.`
- **After (~330 B):** `Create an agent. Requires relationship, workspace, and either provider/model (e.g. codex/gpt-5.4) or a personality name. Title and initialPrompt are optional — omit both to open a bare new chat that greets the user. Prefer a personality when the host has them (list_personalities). Don't guess the provider — call list_providers/list_models if unsure.`
- **Saving:** ~75 B. Every steer (both-optional, prefer-personality, don't-guess) retained.

### 6.3 `create_agent` `personality` field describe

- **Before (470 B):** `Spawn from a named Agent Personality configured on this host. Expands to its provider/model/effort/mode/prompt; explicit provider/settings override per-field. Any agent may spawn by personality name (see list_personalities for each one's guidance and tier — coordinators delegate; focused writer/coder/judger personalities are spawned to finish one task). Fails loudly if the personality is unavailable here — no fallback.`
- **After (~330 B):** `Spawn from a named Agent Personality on this host — expands to its provider/model/effort/mode/prompt; explicit provider/settings override per-field. See list_personalities for each one's guidance and tier (coordinators delegate; focused writer/coder/judger personalities finish one task). Fails loudly if unavailable here — no fallback.`
- **Saving:** ~140 B.

### 6.4 Worktree-target union describes (shared const, serialized in BOTH create_agent + create_worktree)

`AgentCreateWorktreeTargetInputSchema` (`otto-tools.ts:1305-1341`). "… in a new Otto worktree." is
redundant with the enclosing context (both call sites already say "worktree").

- `Create a new branch in a new Otto worktree.` → `Branch off a new branch.`
- `Check out an existing branch in a new Otto worktree.` → `Check out an existing branch.`
- `Check out a GitHub pull request in a new Otto worktree.` → `Check out a GitHub PR.`
- **Saving:** ~90 B × **2 serializations** ≈ **~180 B**.

### 6.5 `create_artifact` description + `modeId` field

- Description **before (593 B)** → **after (~430 B):** dropped the doubled "unattended (bypass/no
  approval prompts)" (kept once) and tightened to
  `Create an artifact: a self-contained HTML page (report, dashboard, visualization, mockup) generated by a background agent and shown in the Artifacts screen. Returns immediately as "generating" and flips to "ready"/"error" on its own within minutes — no need to poll. Runs unattended and inherits your provider/model/effort/mode unless overridden. The generator can't see this conversation, so put all content, data, and requirements in the description.`
- `modeId` describe **before (330 B)** → **after (~190 B):**
  `Permission mode id for the generation agent (unattended/bypass modes only — anything else falls back to the provider's unattended default, so generation never stalls). Defaults to your own mode when generating with your provider.`
- **Saving:** ~300 B combined.

### 6.6 `spawn_task` / `dismiss_task` / `list_personalities`

- `spawn_task` description 756 → ~540 B (kept the full "when to call / when NOT to" contract; cut
  the restated "each returns a task_id … dismiss_task" tail, which the `task_id` output + dismiss_task
  already convey). **~216 B.**
- `dismiss_task` 417 → ~300 B (tightened the replacement-flow aside). **~110 B.**
- `list_personalities` 538 → ~410 B (the `tier`/`guidance`/`canLaunch` field meanings are already in
  the output schema describes — the tool description now points at them instead of re-defining them).
  **~130 B.**

### 6.7 `preview_start` (guardrail — conservative)

Kept every steer (ALWAYS use this, browserId is the verify tab, don't-open-extra-tabs, launch.json
scaffold). Only merged two adjacent sentences and dropped "in the workspace" (implied). **~60 B.**
Did **not** touch the `LAUNCH_JSON_FORMAT` block (`preview-tools.ts`) — it's a literal the agent
copies.

### 6.8 Applied re-measurement

Re-ran this review's harness after the edits:

|                                               |                Before |                     After |                               Δ |
| --------------------------------------------- | --------------------: | ------------------------: | ------------------------------: |
| Agent scope, browser+preview+personalities on | 49,106 B / 12,277 tok | **47,759 B / 11,940 tok** | **−1,347 B / −337 tok (−2.7%)** |
| Top-level scope (same config)                 | 50,307 B / 12,577 tok | **48,960 B / 12,240 tok** |             −1,347 B / −337 tok |

(Plus the **~225 tok** browser dedup in §5 once WP-C applies it → combined ~560 tok / ~4.6% off the
agent-scope catalog, on **every model request of every agent**.)

## 7. Not applied — flagged with reasons

- **Tool `title` fields (~316 tok, 1,266 B).** Dropped on the openai-compat path already (free
  there); on the MCP path (Claude/Codex/OpenCode/Pi/ACP) they ride the `tools/list` envelope. Most
  duplicate the name (`create_agent`→"Create agent"). Removing them is a real MCP-path win **but**
  titles feed Otto's own UI tool-label display in places — needs a check against `getToolDisplayName`
  before cutting. **Recommend:** verify UI independence, then drop titles that are just Title-Cased
  names. Separate, low-risk WP.
- **`create_agent` union structure.** That's the feature surface; collapsing it removes capability.
- **9 legacy top-level fields.** Back-compat; describe-trim only (§4) until a `COMPAT` cleanup.
- **`maximum: 9007199254740991` on integer fields.** A `z.toJSONSchema` artifact (`Number.MAX_SAFE_INTEGER`)
  on every `.int()` field — githubPrNumber ×2, maxRuns, browser_logs.maxEntries, page_text.maxChars,
  browser_wait.timeoutMs, browser_resize.width/height, preview_logs.lines ≈ **~280 B / ~70 tok** of
  noise. It's a **serialization** concern, not language — hand to WP-C (a post-process that strips
  the max, or a shared int-schema helper). Don't drop `.int()` (loses validation).
- **2-space-JSON result inflation** (`mcp-server.ts` `formatStructuredContentForModel`,
  `ottoResultToText`, `preview-tools.ts` `success()`): out of scope per the brief — **WP-C** owns
  result formatting.

## 8. Prioritized edit list

|   # | Edit                                                                       | Owner            |           Est. saving/req | Status        |
| --: | -------------------------------------------------------------------------- | ---------------- | ------------------------: | ------------- |
|   1 | Shorten `EFFORT_INPUT_DESCRIPTION` (×7)                                    | this WP          |                  ~103 tok | **applied**   |
|   2 | Browser boilerplate → short forms (×26)                                    | **WP-C**         |                  ~225 tok | proposed (§5) |
|   3 | `create_artifact` desc + modeId                                            | this WP          |                   ~75 tok | **applied**   |
|   4 | `spawn_task`/`dismiss_task`/`list_personalities`                           | this WP          |                  ~115 tok | **applied**   |
|   5 | `create_agent` desc + personality field                                    | this WP          |                   ~54 tok | **applied**   |
|   6 | Worktree union describes (×2 serializations)                               | this WP          |                   ~45 tok | **applied**   |
|   7 | Drop Title-Cased `title` fields (MCP path)                                 | new WP           |       ~316 tok (MCP only) | proposed (§7) |
|   8 | Strip `maximum: MAX_SAFE_INTEGER` in serialization                         | **WP-C**         |                   ~70 tok | proposed (§7) |
|   9 | `create_agent` 9 legacy fields — describe-trim now, `COMPAT` removal later | this WP / future | ~135 B now, ~1.2 KB later | proposed (§4) |
|  10 | `preview_start` prose merge                                                | this WP          |                   ~15 tok | **applied**   |

Applied total (this WP): **~337 tok/req** off the agent-scope catalog (measured). With WP-C items
2 + 8: **~630 tok/req (~5.1%)** — paid on every request of every agent once tools are injected.
