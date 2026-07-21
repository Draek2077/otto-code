# Suggested tasks: the card doesn't pop

Related: [projects/suggested-tasks](../suggested-tasks/suggested-tasks.md),
`packages/server/src/server/agent/tools/otto-tools.ts`.

## Fixed 2026-07-20 — "suggest a task" now triggers `spawn_task`

The tool was never broken or missing. It is registered in `otto-tools.ts`,
auto-approved in every permission mode for Claude
(`AUTO_APPROVED_OTTO_TOOL_NAMES`), present in the openai-compat default tool set
(`openai-compat-otto-tool-permissions.ts`), and the client-side
`suggestedTasksEnabled` setting defaults to `true`. Saying "spawn a task" always
worked — which proves reachability and localises the fault to **triggering
vocabulary**.

The old description opened with _"Suggest a follow-up task the user can start
later…"_ — descriptive prose, not an instruction to act. Two consequences:

1. Models matched the user's words against the **tool name** (`spawn_task`), so
   "suggest a task" missed while "spawn a task" hit.
2. Nothing told the model to call it **unprompted**, so it rarely volunteered —
   unlike Claude Desktop, where the same-named tool fires on its own.

Rewritten to fix both: it now opens with the imperative "Suggest a task. Flag an
out-of-scope issue…", states explicitly that noticing is the trigger and that the
model should not wait for permission or merely mention the idea in prose, and
enumerates the user phrasings that mean this tool ("suggest a task", "make that a
task", "queue that up", "spin that off", "flag that for later", "spawn a task",
…).

**Names already match Claude Desktop** — `spawn_task` / `dismiss_task`, differing
only by the MCP server prefix each harness imposes (`mcp__otto__` vs
`mcp__ccd_session__`). Nothing to rename; keep it that way. If Claude Desktop's
wording for these tools changes, re-sync this description rather than diverging —
cross-harness fluency is the goal.

**Still to verify in real use:** whether Claude models now volunteer suggestions
at the same rate they do in Claude Desktop. If not, the next lever is
prompt-level guidance rather than more description text.

## Fixed 2026-07-20 — the card now carries a blue tint

The card was neutral panel chrome (`surface2` fill, `borderAccent` ring) — the
same treatment as every quiet surface in the app, which is exactly why it read
as a log line.

It now takes the **info tone**: a `statusInfo` ring around a
`statusInfoSurface`-washed header and body, with the lightbulb in `statusInfo`.
Both tokens already existed in the status-tint family, calibrated per light and
dark, so this added no theme tokens at all. Because the fills are alpha and
every black variant is built through `buildDarkSemanticColors`, one token is
correct in light, dark, and the black chat scope with no branching and no
`useUnistyles()` — the whole change lives in
`StyleSheet.create((theme) => …)`.

Blue over the theme accent, deliberately:

- Accent is the CTA colour and already paints the start button inside this
  card, so an accent-washed card would read as more of the same chrome rather
  than as a different kind of thing.
- On the monochrome variants (Graphite, Midnight) `accentBright` is near-white,
  so an accent "tint" would have carried no hue at all — failing the colour
  requirement on those themes specifically.
- Blue reads as _suggestion_ in every variant instead of shifting hue with the
  user's theme pick.

The split button keeps an opaque `surface2` fill so it separates from the wash
instead of dissolving into it; its accent chrome is what marks it as the action
inside a blue card. Documented in [docs/design.md](../../docs/design.md) §12.

The card floats over the stream, so the wash sits on the children over an
opaque `surface2` base — washing the card itself would let chat text show
through.

**Layering:** `CHAT_PANE_OVERLAY_Z` in
`packages/app/src/constants/layout.ts` now states the stacking order for
overlays that float over the conversation, and the card claims
`suggestedTasks: 30` above a reserved `visualizerPip: 20`. Previously the card
relied on sibling paint order, which any later-mounted overlay would win — see
[projects/visualizer-pip](../visualizer-pip/visualizer-pip.md), which should
read its slot from that map rather than picking a number.
