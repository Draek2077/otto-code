# WP-E · Wire the behavior toggles into their subsystems

> Wave 2 (after WP-A adds the config fields). You only **read** `agentBehaviors.*` and wire
> the behavior — do not edit the config chain or Host settings (WP-A owns those). Parent:
> [token-cost-fixes.md](token-cost-fixes.md), audit §4.2.

## Goal

Make the three hard-coded Claude behaviors (and the notify-on-finish default) honor the
daemon toggles WP-A added, following the provider-parity rule: Claude reads them; providers
that don't support a behavior ignore the setting.

## Tasks

1. **`promptSuggestions`.** Currently hard-coded `true` at
   `packages/server/src/server/agent/providers/claude/agent.ts:3309`. Read
   `agentBehaviors.promptSuggestions` (default true) and pass it through. Also respect the
   CLI env kill-switch `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` (audit-verified) as an
   alternative off path. Note: the app already has a device-local _render_ toggle
   (`AppSettings.promptSuggestionsEnabled`); this new daemon flag controls _generation_.
2. **`agentProgressSummaries`.** Hard-coded `true` at `claude/agent.ts:3305`. Read
   `agentBehaviors.agentProgressSummaries` (default true) and pass it through. When off,
   observed-subagent rows keep tool-level activity (free transcript tailing) but lose the
   ~30s AI progress blurb.
3. **`notifyOnFinishDefault`.** The default is currently implicit
   (`notifyOnFinish = Boolean(callerAgentId)`, `otto-tools.ts:2173`; also :1660). Make the
   default read `agentBehaviors.notifyOnFinishDefault` (default true, preserving today's
   behavior) so a user can stop agent-to-agent finish notifications from forcing full parent
   turns. Per-call args still override.

## Constraints

- Provider parity: only Claude consumes `promptSuggestions`/`agentProgressSummaries`; other
  providers ignore them (no-op, no error). `notifyOnFinishDefault` is Otto's tool-default
  and applies wherever `create_agent`/`send_agent_prompt` run.
- Defaults must preserve current behavior (all true) so nothing changes until a user opts
  out.
- Heads-up: WP-D also edits `claude/agent.ts` (usage-mapping region ~:1980) and
  `agent-manager.ts`; you edit the Claude options block (~:3305-3309) and the
  `otto-tools.ts` notify default. Distinct regions; coordinate if you collide.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`.

## Deliverable

The three behaviors wired to their daemon flags with parity handling, defaults preserving
current behavior. `wp-e-findings.md` notes exactly where each flag is read and the
provider-parity behavior for non-Claude providers.
