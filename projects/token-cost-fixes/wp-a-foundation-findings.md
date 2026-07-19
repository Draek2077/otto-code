# WP-A · Foundation — findings

Status: **implemented**, typecheck + lint green, scoped tests green (see end). Working
tree left uncommitted for the user to review. Version tag for all new COMPAT flags:
**v0.6.4** (the in-progress release; repo version is still 0.6.3).

Downstream packages (WP-B, WP-E, WP-G) read the fields below — the names/defaults here are
the contract.

---

## 1. Final field names & defaults (the shared contract, as shipped)

All fields are additive, `.optional()`/`.default()`, back-compatible in both directions.

### On `MutableDaemonConfig` (wire — `packages/protocol/src/messages.ts`)

| Field                                          | Type                       | Default                            | Notes                                                                                                          |
| ---------------------------------------------- | -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mcp.toolGroups`                               | `OttoToolGroup[]` optional | **undefined = all groups enabled** | Added to the existing `mcp` object (still `.passthrough()`). Enum reused: `z.array(z.enum(OTTO_TOOL_GROUPS))`. |
| `agentBehaviors.promptSuggestions`             | `boolean`                  | `true`                             | New `MutableAgentBehaviorsConfigSchema` (`.passthrough()`).                                                    |
| `agentBehaviors.agentProgressSummaries`        | `boolean`                  | `true`                             |                                                                                                                |
| `agentBehaviors.notifyOnFinishDefault`         | `boolean`                  | `true`                             | The current implicit default.                                                                                  |
| `metadataGeneration.enabled`                   | `boolean`                  | `true`                             | Added to existing `MutableMetadataGenerationConfigSchema`.                                                     |
| `metadataGeneration.preferWriterPersonalities` | `boolean`                  | **`false`**                        | Cheap-tier is the default.                                                                                     |

`agentBehaviors` itself defaults to `{ promptSuggestions: true, agentProgressSummaries: true,
notifyOnFinishDefault: true }` on `MutableDaemonConfigSchema`. The patch schema adds
`agentBehaviors: MutableAgentBehaviorsConfigSchema.partial().optional()`; `mcp.toolGroups`
and `metadataGeneration.*` patch through the already-present `mcp`/`metadataGeneration`
partial patch entries.

> **Gotcha for anyone touching `MutableMetadataGenerationConfigSchema`:** it is used with an
> object `.default({...})` at the `MutableDaemonConfigSchema` level. Adding a defaulted field
> to the inner schema forces you to also update that outer default literal (now
> `{ providers: [], enabled: true, preferWriterPersonalities: false }`) or protocol typecheck
> breaks. Three app test fixtures that hand-build a full `MutableDaemonConfig`
> (`push-router.test.ts`, `browser-tools-config.test.ts`, `providers-section.test.tsx`) had
> to gain the new fields for the same reason.

### On persisted config (`packages/server/src/server/persisted-config.ts`)

- `daemon.mcp.toolGroups?: OttoToolGroup[]` (mcp object stays `.passthrough()`).
- `daemon.agentBehaviors?: { promptSuggestions?, agentProgressSummaries?, notifyOnFinishDefault? }` (new `.passthrough()` object; absent field = implicit default on).
- `agents.metadataGeneration` (`AgentMetadataGenerationSchema`, `.strict()`) gains
  `enabled?: boolean` and `preferWriterPersonalities?: boolean`.

### On `OttoDaemonConfig` (in-memory — `bootstrap.ts`)

- `mcpToolGroups?: OttoToolGroup[]`
- `agentBehaviors?: { promptSuggestions?, agentProgressSummaries?, notifyOnFinishDefault? }`
- `metadataGeneration` extended with `enabled?` and `preferWriterPersonalities?`

### `server_info.features.*` (COMPAT flags, all v0.6.4)

- `mcpToolGroups` — daemon honors per-group gating of the MCP catalog.
- `agentBehaviorToggles` — daemon persists `agentBehaviors.*`.
- `metadataGenerationEnabled` — daemon persists `metadataGeneration.{enabled,preferWriterPersonalities}`.

All three are set `true` unconditionally in `websocket-server.ts` (`buildServerInfoFeatures`).

---

## 2. Config-chain wiring (the full pass, one owner)

1. **Persisted schema** — `persisted-config.ts`: fields above; imports `OTTO_TOOL_GROUPS`.
2. **Resolver** — `config.ts`: `resolveMcpToolGroups`, `resolveAgentBehaviors` (mirroring
   `resolveBrowserToolsEnabled`); both threaded through `resolveStaticLoadConfigSettings` and
   the `loadConfig` return. `metadataGeneration` already flows whole
   (`persisted.agents?.metadataGeneration`) — the two new keys ride along.
3. **Initial mutable config** — `bootstrap.ts` `createInitialMutableDaemonConfig`: builds the
   `mcp`, `agentBehaviors`, `metadataGeneration` sections via three extracted helpers
   (`buildInitialMcpSection` / `buildInitialAgentBehaviors` / `buildInitialMetadataGeneration`)
   — extracted to keep the function under the cyclomatic-complexity lint cap.
4. **Wire schemas** — `messages.ts` as in §1.
5. **Merge-back** — `daemon-config-store.ts` `mergeMutableConfigIntoPersistedConfig`:
   - `mcp.toolGroups` written via `buildPersistedMcpSection` — **only persisted when defined**
     (undefined never freezes onto disk).
   - `agentBehaviors` **always written** to the daemon object (consistent with
     `browserTools`/`autoArchiveAfterMerge`, which are also always written); reader
     `readAgentBehaviors` treats any non-`false` as on.
   - `metadataGeneration.{enabled,preferWriterPersonalities}` folded into the persisted
     `metadataGeneration`; `computeShouldPersistMetadataGeneration` now also persists when a
     flag is non-default (so turning `enabled` off with zero providers still sticks).
6. **Hot-reload** — `mcp.toolGroups` uses a **live-read policy**, not `onFieldChange`
   (§3). `agentBehaviors.*` hot-reload is **left to WP-E** (it owns the reads; WP-A only adds
   the persisted/live-readable fields). No `onFieldChange` was added for behaviors here.
7. **Capability flags** — §1.

---

## 3. Per-group MCP gating (the core mechanism)

- New live-read policy `DaemonConfigOttoToolGroupsPolicy` in
  `packages/server/src/server/agent/tools/tool-groups-policy.ts` (mirrors
  `DaemonConfigBrowserToolsPolicy`): `getEnabledGroups()` reads
  `daemonConfigStore.get().mcp.toolGroups`, validated against the known group set;
  `undefined = all groups`.
- `OttoToolHostDependencies` gains `enabledOttoToolGroups?: OttoToolGroup[]`
  (`otto-tools.ts`). `createOttoToolCatalog` wraps `registerTool` with a group filter using
  the existing `ottoToolGroupForName(name)` (provider-config.ts) — **a tool whose group is
  disabled is never registered**, so the MCP path and any future catalog consumer inherit the
  filter. Filtering lives in the catalog builder, per the brief.
- Wired in `bootstrap.ts` `createAgentToolHostDependencies` as
  `enabledOttoToolGroups: ottoToolGroupsPolicy.getEnabledGroups()`. **Why this is live:** the
  agent MCP server is built per request (stateless transport, `createAgentMcpSession`), and
  the deps are rebuilt each call — so re-reading the policy at dep-build time makes category
  toggles take effect without a daemon restart. No `onFieldChange` needed.
- openai-compat's per-provider `ottoToolGroups` path is untouched (daemon-wide `mcp.toolGroups`
  is the MCP-path floor; the provider override remains its own narrowing).

### browserTools / group reconciliation rule (chosen & shipped)

**`browserTools.enabled` remains the authoritative master for the `browser` group; the
group filter can only further restrict, never re-enable.** Concretely:

- `browser_*` tools register only when **`browserTools.enabled === true` AND `browser` ∈
  enabled groups**. The existing `if (options.browserToolsEnabled && ...)` gate around
  `registerBrowserTools` is unchanged; the new group filter in `registerTool` is an
  additional AND on top.
- The **`preview` group is gated by the group filter alone** — it is _not_ newly tied to
  `browserTools.enabled`. Rationale: `browserTools.enabled` **defaults to `false`**, while
  preview tools today register whenever a `DevServerManager` is present. Gating preview by the
  browser master would silently kill Preview for every host that never turned browser tools on
  — a regression in a load-bearing subsystem. So the recommendation to "gate browser/preview
  by the master" was applied to `browser` only, deliberately, to preserve behavior.
- In the categorized Host UI, the **Browser** category toggles `browser` membership in
  `mcp.toolGroups`; the existing browser-tools card still owns `browserTools.enabled` as the
  lower-level master. The Browser category card's description states it also requires that
  master.

---

## 4. Host settings UI

`packages/app/src/screens/settings/`:

- `otto-tools-config.ts` — pure logic: `OTTO_TOOL_GROUP_META` (8 categories, display order +
  copy), `resolveEnabledToolGroups`/`isToolGroupEnabled`/`createToolGroupsPatch`,
  `AGENT_BEHAVIOR_META` + `isAgentBehaviorEnabled`/`createAgentBehaviorPatch`, and the
  metadata-generation read/patch helpers. `createToolGroupsPatch` always writes the **full
  canonical membership array** (so "all on" persists as the complete list — equivalent to
  undefined, which the daemon also reads as all-enabled).
- `otto-tools-section.tsx` — the categorized `OttoToolsSection` (each switch toggles a
  `mcp.toolGroups` member) plus `AgentBehaviorCards` and `MetadataGenerationCards`. Toggle
  cards copy the `browser-tools-card.tsx` `useMutation` pattern (failed patch surfaces
  inline). Split into per-type wrapper components with `useCallback` handlers to satisfy the
  `jsx-no-new-function-as-prop` lint rule. Each section/card group is **capability-gated**
  (`useMcpToolGroupsFeature` / `useAgentBehaviorTogglesFeature` /
  `useMetadataGenerationEnabledFeature`, reading `serverInfo.features.*`).
- `host-page.tsx` `HostAgentsPage`: `AgentBehaviorCards` + `MetadataGenerationCards` render
  inside the existing **Agents** `SettingsSection`; the categorized `OttoToolsSection` renders
  directly beneath it. All daemon settings → all in Host settings, per the placement rule.

Copy is raw English (developer-mode host surfaces are English-only pending a translation
pass — build-first, translate-last). No locale keys added.

---

## 5. App feature-hiding — UI-visibility source-of-truth model

**Model chosen: the daemon `mcp.toolGroups` set is the single source of truth for
tool-category feature visibility.** There is no second device-local switch to keep in sync
for these features. The device-local `feature-catalog.ts` flag stays reserved for
**presentation-only** features that have no daemon tool group (the Visualizer remains the
reference for that lane, with its React.lazy panel exclusion).

- Bridge hook: `packages/app/src/hooks/use-otto-tool-group-enabled.ts`
  `useOttoToolGroupEnabled(serverId, group)` — reads `useDaemonConfig`, returns
  `true` when `mcp.toolGroups` is undefined (all enabled / old daemon), else membership.
  This is the mechanism a feature's entry point calls to hide itself when its group is off.

**Why entry points aren't force-wired in this pass (and where they belong):** the obvious
user-facing surfaces (Schedules, Artifacts) are **multi-host aggregated** views
(`schedules-screen.tsx` iterates every host; there is no single `serverId`), so hiding them
requires a per-host-scope decision that belongs to each feature's owner, not the foundation.
For a **single-host-scoped** surface (a workspace panel/entry with a `serverId` in scope),
the call is a one-liner: `useOttoToolGroupEnabled(serverId, "schedules")` etc. The hook +
the daemon-as-source-of-truth model are the deliverable; per-feature entry-point gating is a
thin, low-risk follow-up documented here. (The categorized settings section itself already
reflects and drives the group state live.)

---

## 6. Files touched

Server / protocol:

- `packages/protocol/src/messages.ts` — schemas + features.
- `packages/server/src/server/persisted-config.ts`
- `packages/server/src/server/config.ts`
- `packages/server/src/server/bootstrap.ts`
- `packages/server/src/server/daemon-config-store.ts`
- `packages/server/src/server/websocket-server.ts`
- `packages/server/src/server/agent/tools/otto-tools.ts`
- `packages/server/src/server/agent/tools/tool-groups-policy.ts` (new)

App:

- `packages/app/src/screens/settings/otto-tools-config.ts` (new)
- `packages/app/src/screens/settings/otto-tools-section.tsx` (new)
- `packages/app/src/screens/settings/host-page.tsx`
- `packages/app/src/hooks/use-otto-tool-group-enabled.ts` (new)

Tests updated/added:

- `packages/server/src/server/agent/mcp-server.test.ts` — new test: catalog gated by
  `enabledOttoToolGroups` (undefined = all, exclude a group drops its tools, `[]` = zero tools).
- `packages/server/src/server/daemon-config-store.test.ts` — two persisted-shape assertions
  updated for the new `metadataGeneration.{enabled,preferWriterPersonalities}` fields.
- `packages/app/src/data/push-router.test.ts`,
  `packages/app/src/screens/settings/browser-tools-config.test.ts`,
  `packages/app/src/screens/settings/providers-section.test.tsx` — fixtures gained the new
  required-with-default fields.

---

## 7. Verification

- `npm run build:client` + `npm run build:server` — clean.
- `npm run typecheck` (all packages) — clean.
- `npm run lint -- <all changed files>` — 0 warnings, 0 errors.
- Scoped tests: `daemon-config-store.test.ts` (28 passed), `mcp-server.test.ts` new gating
  test (passed).

### Pre-existing failures NOT caused by WP-A (flagged for the owner)

`mcp-server.test.ts` has **2 pre-existing failures** unrelated to this package:
`create_agent MCP tool > requires a concise title no longer than 60 characters` and
`> requires initialPrompt`. These assert `title`/`initialPrompt` are **required**, but the
uncommitted changeset already made them **optional** (bare-spawn: "omit both to just open a
new chat", `otto-tools.ts:1633` + `resolveBareSpawnTitleAndPrompt`). WP-A's group filter,
with `enabledOttoToolGroups` undefined in those tests, registers `create_agent` unchanged —
so it is not the cause. Left untouched (not WP-A's files/scope).
