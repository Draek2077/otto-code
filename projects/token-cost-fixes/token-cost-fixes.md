# Token-cost fixes — master plan

> Parent audit: [projects/token-cost-audit/token-cost-audit.md](../token-cost-audit/token-cost-audit.md).
> This folder decomposes the audit's remediation menu into sub-agent work packages.
> Locked decisions (2026-07-18): cheap-tier-default generation routing; **full
> bare-completion refactor** for generations; extend the metrics page into a two-column
> usage+cost view; **foundation-first** dispatch.

## Principles (apply in every package)

- **Genuine waste gets cut; feature-inherent cost gets a toggle.** We don't fight a cost
  that is how a feature fundamentally works — we expose it so the user chooses.
- **Claude is the reference tier.** Every behavior toggle maps to a capability. A provider
  that can't honor a setting **silently ignores it** — never errors, never degrades.
- **Settings placement:** daemon settings live in **Host settings**
  (`MutableDaemonConfig` via `useDaemonConfig`/`patchConfig`); frontend/presentation
  settings live in **App settings** (`AppSettings` via `useAppSettings`, device-local).
- **Protocol stays back-compatible** (additive fields, `.default()`, `COMPAT(...)` tags);
  **features may require a new daemon capability** gated in `server_info.features.*`.
- **Do not commit.** Agents run in the shared working tree (the repo carries a large
  uncommitted changeset, so worktrees would miss it). Each agent runs `npm run typecheck`
  and `npm run lint -- <changed files>` and leaves the tree for the user to review/commit.
- The user runs their own dev instance — **never start a second daemon/Expo/preview** to
  verify.

## Shared config contract (WP-A owns; others only READ these)

To prevent config-chain collisions, **WP-A adds every new daemon field below in one pass**
(persisted-config.ts → config.ts resolver → bootstrap init → messages.ts schema+patch →
daemon-config-store merge-back → onFieldChange/policy), plus the Host-settings UI and app
feature-gating. Behavior packages consume these flags in their own subsystem files only.

| Field (on `MutableDaemonConfig`)               | Type / default                                                                           | Read by                   | COMPAT flag                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- | --------------------------- |
| `mcp.toolGroups`                               | `OttoToolGroup[]` optional; **undefined = all enabled** (mirror openai-compat semantics) | MCP catalog gating (WP-A) | `mcpToolGroups`             |
| `agentBehaviors.promptSuggestions`             | `boolean` default `true`                                                                 | Claude provider (WP-E)    | `agentBehaviorToggles`      |
| `agentBehaviors.agentProgressSummaries`        | `boolean` default `true`                                                                 | Claude provider (WP-E)    | `agentBehaviorToggles`      |
| `agentBehaviors.notifyOnFinishDefault`         | `boolean` default `true` (current implicit default)                                      | otto-tools default (WP-E) | `agentBehaviorToggles`      |
| `metadataGeneration.enabled`                   | `boolean` default `true`                                                                 | generation path (WP-B)    | `metadataGenerationEnabled` |
| `metadataGeneration.preferWriterPersonalities` | `boolean` default **`false`** (cheap-tier is the default)                                | routing (WP-B)            | `metadataGenerationEnabled` |

Group semantics reuse the existing `OTTO_TOOL_GROUPS` = `preview, browser, web, agents,
terminals, schedules, artifacts, workspace` and `ottoToolGroupForName` (provider-config.ts).
WP-A reconciles the existing `browserTools.enabled` flag with the new `browser` group
(recommend: keep `browserTools.enabled` as the authoritative browser master for back-compat
and treat the `browser`/`preview` groups as additionally gated by it; document the chosen
rule in the WP-A findings).

## Work packages & dispatch waves

**Wave 1 (now): WP-A alone** — it owns the config chain + Host settings + app feature-gating

- per-group MCP gating. Everything settings-shaped depends on it, so it lands first.

**Wave 2 (after WP-A): parallel, non-overlapping subsystem files**

- **WP-B** generation subsystem — bare-completion refactor + cheap-tier routing + double-gen
  bug. Files: `structured-generation-providers.ts`, `agent-response-loop.ts`, `agent-manager.ts`
  (spawn path). Reads `metadataGeneration.*`.
- **WP-C** result caps + description dedup. Files: `mcp-server.ts` (result formatting),
  `browser-tools/*`, `preview/*`, `activity-curator.ts`, fork path. _(Note: WP-A also edits
  `mcp-server.ts` registration — sequence WP-C after WP-A to avoid the shared file.)_
- **WP-D** openai-compat efficiency + usage capture. Files: `openai-compat-agent.ts`,
  `claude/agent.ts` (usage mapping), `agent-manager.ts` (token increments). Feeds WP-G.
- **WP-E** wire behavior toggles into subsystems. Files: `claude/agent.ts` (options),
  `otto-tools.ts` (notifyOnFinish default). Reads `agentBehaviors.*`.
- **WP-F** settings-placement audit (sweep existing misplacements).

**Wave 3 (after WP-D + WP-A): WP-G** two-column Usage & Cost page.

**Standalone session:** catalog language/bulk review
([wp-catalog-language-review.md](wp-catalog-language-review.md)) — orthogonal, owns tool
_wording_; produces findings, hands mechanics to WP-C.

## Overlap notes (why the waves are shaped this way)

- Config-chain files (`messages.ts`, `persisted-config.ts`, `config.ts`, `bootstrap.ts`,
  `daemon-config-store.ts`) and `host-page.tsx` are collision hotspots → **only WP-A edits
  them**. Behavior agents read the resulting flags in subsystem files only.
- `mcp-server.ts` is touched by WP-A (registration gating) and WP-C (result formatting) →
  WP-C runs after WP-A.
- `claude/agent.ts` and `agent-manager.ts` are touched by WP-D (usage) and WP-E (options);
  distinct functions, low risk, but keep them in the same wave with a heads-up in each doc.
