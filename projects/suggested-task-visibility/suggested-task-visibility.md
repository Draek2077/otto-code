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

## Open — the card blends in

The suggested-task chip doesn't stand out enough in the chat stream. Use
**colour tints** to make it pop — it's an offer of work, not a log line.

- Tints must work in light, dark, and the black chat theme (see
  [docs/design.md](../../docs/design.md) — use theme tokens, and note the
  `useUnistyles()` ban in [docs/unistyles.md](../../docs/unistyles.md)).
- Related layering note: suggested-task chips must render **above** a Visualizer
  PIP if that ships — see
  [projects/visualizer-pip](../visualizer-pip/visualizer-pip.md).
