# WP-A · Foundation — Otto tool categories, daemon toggles, settings placement

> Wave 1, runs alone first. Owns the entire settings surface for this initiative so no
> other package touches the config chain or Host settings screen. Read the master plan
> [token-cost-fixes.md](token-cost-fixes.md) (shared config contract) and the audit
> [token-cost-audit.md](../token-cost-audit/token-cost-audit.md) first.

## Goal

1. Give the Otto tools settings feature-based **categories** with toggles (like the
   openai-compat provider's `ottoToolGroups`, but daemon-wide on the MCP path, which has
   **no per-group gating today**). When a category is off, **hide that feature from the UI**.
2. Add the daemon config fields for all new toggles in the shared contract (so behavior
   packages can just read them).
3. Enforce the placement rule: these are daemon settings → **Host settings**.

## Scope (implement the full shared config contract in one pass)

Add these `MutableDaemonConfig` fields end-to-end: `mcp.toolGroups`,
`agentBehaviors.{promptSuggestions, agentProgressSummaries, notifyOnFinishDefault}`,
`metadataGeneration.{enabled, preferWriterPersonalities}`. Defaults per the contract table.
Behavior _wiring_ (reading them where the behavior happens) belongs to WP-B/WP-E — **you
add the fields + UI; they consume them.**

## The config chain (exact extension points, from the settings map)

1. **Persisted schema** — `packages/server/src/server/persisted-config.ts`: `daemon` object
   (~:337-353) for `mcp.toolGroups` + `agentBehaviors`; `agents.metadataGeneration`
   (`AgentMetadataGenerationSchema` ~:180-184) for the two new metadata fields.
2. **Resolver** — `packages/server/src/server/config.ts`:
   `resolveStaticLoadConfigSettings` (~:433-454) maps persisted → `OttoDaemonConfig`;
   add resolvers mirroring `resolveBrowserToolsEnabled`/`resolveAppendSystemPrompt`.
   `OttoDaemonConfig` types in `bootstrap.ts` (~:377-411).
3. **Initial mutable config** — `bootstrap.ts` `createInitialMutableDaemonConfig` (~:612-676):
   add the new objects (`mcp.toolGroups`, `agentBehaviors`, extend `metadataGeneration`).
4. **Wire schemas** — `packages/protocol/src/messages.ts`: `MutableDaemonConfigSchema`
   (~:448-479), its sub-schemas (`MutableMetadataGenerationConfigSchema` ~:154-158; add a
   new `MutableAgentBehaviorsConfigSchema`; extend `mcp` object ~:450-454), and the parallel
   `MutableDaemonConfigPatchSchema` (~:481-514). All additive with `.default()` /
   `.optional()`. Reuse `z.array(z.enum(OTTO_TOOL_GROUPS))` for `mcp.toolGroups` (the enum
   already exists in provider-config.ts and is already used at messages.ts:142).
5. **Merge-back** — `packages/server/src/server/daemon-config-store.ts`
   `mergeMutableConfigIntoPersistedConfig` (~:379-435): add write-back branches + reader
   helpers (pattern: `readBrowserToolsEnabled` :385, `readMetadataGenerationProviders` :789).
6. **Hot-reload** — `bootstrap.ts` (~:1703-1709): `onFieldChange` for behaviors that must
   take effect live; **for `mcp.toolGroups` follow the `browserToolsPolicy` live-read
   pattern** (`packages/server/src/server/browser-tools/policy.ts`) since the MCP server is
   rebuilt per session (bootstrap.ts:1523).
7. **Capability flags** — `messages.ts` `server_info.features` (~:3506-3600): add
   `mcpToolGroups`, `agentBehaviorToggles`, `metadataGenerationEnabled` booleans, each with
   a `// COMPAT(name): added in vX.Y.Z, drop when floor >= vX.Y.Z` comment.

## Per-group gating on the MCP path (the core mechanism)

Today `mcp-server.ts:81-92` registers **every** catalog tool, and
`createOttoToolCatalog` (`otto-tools.ts:870`) only gates browser/preview (:1609-1626).
Add group filtering:

- Thread an `enabledOttoToolGroups?: OttoToolGroup[]` (undefined = all) into
  `OttoToolHostDependencies` (`otto-tools.ts:119`), sourced live from a policy over
  `daemonConfigStore.get().mcp.toolGroups` (mirror `DaemonConfigBrowserToolsPolicy`).
- Filter using the existing `ottoToolGroupForName(name)` (provider-config.ts:70-79) — either
  inside the registration gates in `createOttoToolCatalog`, or in the `mcp-server.ts:81`
  loop. Prefer filtering in the catalog builder so both the MCP path and any future consumer
  inherit it.
- **Reconcile with `browserTools.enabled`:** keep it as the authoritative browser master
  (back-compat); the `browser`/`preview` groups are additionally gated by it. Document the
  final rule.
- openai-compat already honors per-provider `ottoToolGroups`; leave that path intact (the
  daemon-wide `mcp.toolGroups` is the floor; a provider override further narrows).

## Host settings UI (categorized section)

- File: `packages/app/src/screens/settings/host-page.tsx`. Add an "Otto Tools" categorized
  section under `HostAgentsPage` (~:283-303) next to `InjectOttoToolsCard`.
- Pattern: copy `browser-tools-card.tsx` (the richer `useMutation` variant) for each
  category toggle; read/write via `useDaemonConfig`/`patchConfig` (`use-daemon-config.ts`).
  A category switch toggles membership of `mcp.toolGroups`.
- Also surface the three `agentBehaviors` toggles + the two `metadataGeneration` toggles as
  cards in the appropriate Host sections (they're daemon settings). Use the
  `InjectOttoToolsCard` pattern (host-page.tsx:1001) for simple booleans.

## App feature-hiding (categories off → features hidden)

Per `docs/feature-flags.md` (Metro no-tree-shake ⇒ `React.lazy` split is the only real
"not loaded" lever):

- For user-facing categories (Schedules, Artifacts, Browser/Preview), add `FeatureId`
  entries in `packages/app/src/features/feature-catalog.ts` with their `panelKinds`, and
  gate their panels/entry points with `useFeatureEnabled` / `getFeatureEnabledSnapshot`
  (Visualizer is the reference; `visualizer-section.tsx`).
- **Bridge:** the app feature flag (device-local presentation) and the daemon
  `mcp.toolGroups` flag (host-side tool availability) are two switches. Design them to
  agree: when a daemon group is disabled, the corresponding UI feature hides. Simplest: the
  UI reads the daemon config (`useDaemonConfig`) to decide visibility, so there is one
  source of truth (the daemon group set), and the device-local feature flag is only for
  presentation-only features (like Visualizer) that have no daemon group. Document the
  chosen model in findings.

## Constraints

- Additive protocol only; every new field `.optional()`/`.default()`; `COMPAT` tags.
- Provider parity: `agentBehaviors.*` are read only by providers that support them
  (Claude); others ignore. You add the fields; you don't have to wire non-Claude providers.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`.

## Deliverable

The full config-chain additions, per-group MCP gating with a live-read policy, the
categorized Host settings section + behavior/metadata toggle cards, app feature-hiding for
tool categories, and `server_info.features.*` capability flags. Write
`wp-a-foundation-findings.md` documenting the final field names/defaults, the
browserTools/group reconciliation rule, and the UI-visibility source-of-truth model — the
behavior packages (WP-B/WP-E) and WP-G depend on those names.
