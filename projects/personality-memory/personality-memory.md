# Charter: Personality memory

**Status:** Not started — charter drafted 2026-07-16.
**Lineage:** Builds on Agent Personalities ([docs/agent-personalities.md](../../docs/agent-personalities.md))
— the named per-host template is the durable identity this feature attaches memory to. Sibling in spirit
to agent-teams and the orchestration charter ([projects/agent-orchestration](../agent-orchestration/agent-orchestration.md)):
personalities stop being stateless prompt templates and start accumulating experience.

## Why

A personality today is a snapshot: provider/model, effort, mode, prompt, role, colors. Every spawn starts
from zero. But the whole point of naming an agent and giving it a role is continuity — and continuity
without memory is cosmetic.

Concrete motivating cases (user-stated):

- **An orchestrator/planner personality** that watches many runs should be able to note what it observes
  ("the test suite freezes if two workers run vitest concurrently", "worker X is better at UI tasks") so
  the _next_ orchestration starts smarter.
- **A Coder personality** keeps hitting the same mechanism ("Unistyles `useUnistyles()` is forbidden
  here", "this repo's protocol schemas must stay pure") and should be able to remember it instead of
  rediscovering it every session.

The key design word from the user is **simple**: simple memory management techniques, scaled by
personality. A role that produces the most complex thoughts may want structure; a worker wants a
notepad. Complexity is opt-in per personality, not imposed.

## Design sketch

### Where memory lives

- **Daemon-owned, file-based** — same pattern as everything else ([docs/data-model.md](../../docs/data-model.md)):
  a per-personality memory store under the host's data dir, e.g.
  `personalities/<id>/memory/` with a small index + one-fact-per-file, or a single `MEMORY.md` for the
  simple tier. Zod-validated, atomic writes, no migrations.
- **Keyed to the personality id**, not the agent — the agent is ephemeral, the personality is the
  continuity. A spawn-snapshot (the existing lifecycle) carries the personality id, so any agent spawned
  from it reads/writes the same store.
- **Scope question (open):** global-per-personality vs per-personality-per-project. A Coder's gotchas are
  usually repo-specific; an orchestrator's crew observations are host-wide. Lean: namespace by project
  with a small "global" section, but this is the biggest open question.

### How agents use it

- **MCP tools** on the daemon's existing MCP server (same surface personalities already use):
  `remember` (save a fact: text + optional tags) and `recall`/`search_memory` (query). Provider-neutral
  for free — Claude, openai-compat, everyone gets the same tools.
- **Prompt injection:** the memory _index_ (one line per fact, like the harness's own MEMORY.md pattern)
  is stacked into the system prompt at spawn, after the team prompt and personality prompt. Full facts
  load on demand via `recall`. Keeps token cost bounded and predictable.
- **Write discipline in the personality prompt, not code:** the memory _tier_ (below) mostly changes the
  guidance text injected alongside the tools, not the storage engine.

### Tiers (simple vs complex)

A per-personality setting, default **off**:

| Tier       | Storage                      | Guidance injected                                                    |
| ---------- | ---------------------------- | -------------------------------------------------------------------- |
| Off        | —                            | no tools, no prompt section (today's behavior)                       |
| Simple     | single notepad (`MEMORY.md`) | "note durable gotchas/preferences; keep it short; prune when wrong"  |
| Structured | index + typed fact files     | categories (project / feedback / observation), linking, dedup passes |

Roles can suggest a default tier (orchestrator/planner → structured, coder/writer → simple) but the
personality editor owns the final say.

### User visibility & control

- Memory is user-readable and editable — surface it in the personality editor (view/edit/clear), because
  a memory store the user can't inspect is a trust problem.
- A "forget" path (per-fact delete + clear-all) ships in phase 1, not later.

## Build sequence (sketch)

1. **Store + schema:** `FileBackedPersonalityMemoryStore` (index + facts), Zod schemas, size caps.
2. **MCP tools:** `remember` / `recall` gated on the spawning personality's tier; daemon injects the
   index into the system prompt stack (after team + personality prompt).
3. **Editor UI:** tier picker + memory viewer/editor in the personality editor; `features.personalityMemory`.
4. **Structured tier:** typed facts, categories, an occasional consolidation pass (could itself be a
   scheduled internal run — reuse safe-unattended machinery).
5. **Orchestration hook:** conductor personalities auto-note run outcomes (opt-in), feeding the
   agent-orchestration charter.

## Open questions

- **Scope:** per-project vs host-global memory (lean: project-namespaced with a global section).
- **Injection budget:** hard cap on the injected index (lean: ~1–2K tokens, oldest-pruned with a
  consolidation nudge).
- **Who can write:** only the personality's own agents, or can the user/team prompt seed memories?
  (Lean: both — user edits via the editor are first-class.)
- **Cross-personality sharing:** does a team share a memory pool? (Lean: no in v1 — per-personality only;
  teams can get a shared store later if wanted.)
- **Consolidation:** manual button vs automatic scheduled pass (lean: manual in v1).

## Cross-cutting

- **Protocol:** new RPCs use dotted namespaces (`personality.memory.list.request` / `.response`, etc.);
  additive, `features.personalityMemory` flag, no fallback paths.
- **Provider parity:** tools ride the daemon MCP server → all providers at once.
- **Fold-in on ship:** durable design into [docs/agent-personalities.md](../../docs/agent-personalities.md)
  (new "Memory" section), then delete this folder.
