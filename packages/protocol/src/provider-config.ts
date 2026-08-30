import { z } from "zod";
import type { AgentProvider } from "./agent-types.js";
import { AgentProviderSchema, OTTO_BRAIN_PROVIDER_ID } from "./provider-manifest.js";

const ProviderCommandDefaultSchema = z.object({
  mode: z.literal("default"),
});

const ProviderCommandAppendSchema = z.object({
  mode: z.literal("append"),
  args: z.array(z.string()).optional(),
});

const ProviderCommandReplaceSchema = z.object({
  mode: z.literal("replace"),
  argv: z.array(z.string().min(1)).min(1),
});

export const ProviderCommandSchema = z.discriminatedUnion("mode", [
  ProviderCommandDefaultSchema,
  ProviderCommandAppendSchema,
  ProviderCommandReplaceSchema,
]);

export const ProviderRuntimeSettingsSchema = z.object({
  command: ProviderCommandSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
});

const ProviderProfileThinkingOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const ProviderProfileModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  thinkingOptions: z.array(ProviderProfileThinkingOptionSchema).optional(),
});

/**
 * Coarse categories for Otto's agent-facing tool catalog. Providers that receive
 * Otto tools natively (see the openai-compat provider) can be scoped to a subset
 * of these groups; omitting the selection means all groups. Kept deliberately
 * coarse - users pick groups, not individual tools.
 *
 * The list is APPEND-ONLY, and the wire never carries it as a closed enum (see
 * normalizeOttoToolGroups): an older peer must be able to parse a newer peer's
 * selection, dropping names it does not know rather than failing the message.
 */
export const OTTO_TOOL_GROUPS = [
  "preview",
  "browser",
  "web",
  "agents",
  "terminals",
  "schedules",
  "artifacts",
  "widgets",
  "workspace",
  // Split out of the "agents" catch-all, which had grown to hold 60% of the
  // catalog and so could not be switched off for one reason without losing six
  // unrelated capabilities with it.
  "orchestration",
  "knowledge",
  "memory",
  "permissions",
  "providers",
  "tasks",
  "voice",
] as const;

export type OttoToolGroup = (typeof OTTO_TOOL_GROUPS)[number];

/**
 * The taxonomy as it stood before the "agents" split. A stored selection that
 * uses only these names predates the split and is migrated forward by
 * expandLegacyOttoToolGroups.
 */
export const LEGACY_OTTO_TOOL_GROUPS = [
  "preview",
  "browser",
  "web",
  "agents",
  "terminals",
  "schedules",
  "artifacts",
  "widgets",
  "workspace",
] as const satisfies readonly OttoToolGroup[];

/**
 * The categories carved out of the legacy "agents" catch-all. They inherit
 * "agents" when a pre-split selection is migrated forward, and collapse back
 * into it when a current selection is projected back for an older peer.
 */
export const AGENTS_DERIVED_TOOL_GROUPS = [
  "orchestration",
  "knowledge",
  "memory",
  "permissions",
  "providers",
  "tasks",
  "voice",
] as const satisfies readonly OttoToolGroup[];

const OTTO_TOOL_GROUP_SET: ReadonlySet<string> = new Set<string>(OTTO_TOOL_GROUPS);
const LEGACY_OTTO_TOOL_GROUP_SET: ReadonlySet<string> = new Set<string>(LEGACY_OTTO_TOOL_GROUPS);
const AGENTS_DERIVED_TOOL_GROUP_SET: ReadonlySet<string> = new Set<string>(
  AGENTS_DERIVED_TOOL_GROUPS,
);

export function isOttoToolGroup(value: unknown): value is OttoToolGroup {
  return typeof value === "string" && OTTO_TOOL_GROUP_SET.has(value);
}

/**
 * Post-validation normalization for a stored or wire-carried group selection.
 * The schemas that carry it are `string[]` on purpose - wire schemas are pure
 * structural declarations - and this is the one place unknown names are
 * dropped, so a group added by a newer peer degrades to "not selected" instead
 * of failing the whole message.
 *
 * Returns undefined for a non-array, which every caller reads as "all groups".
 */
export function normalizeOttoToolGroups(value: unknown): OttoToolGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<OttoToolGroup>(value.filter(isOttoToolGroup));
  return OTTO_TOOL_GROUPS.filter((group) => seen.has(group));
}

/**
 * Migrate a pre-split selection forward: every category carved out of "agents"
 * inherits whatever "agents" was set to. Without this, upgrading would silently
 * strip project knowledge, orchestration, memory, permissions, provider lookups,
 * tasks and voice from anyone who had ever touched a tool toggle.
 */
export function expandLegacyOttoToolGroups(groups: readonly OttoToolGroup[]): OttoToolGroup[] {
  const selected = new Set<OttoToolGroup>(
    groups.filter((group) => LEGACY_OTTO_TOOL_GROUP_SET.has(group)),
  );
  if (selected.has("agents")) {
    for (const derived of AGENTS_DERIVED_TOOL_GROUPS) {
      selected.add(derived);
    }
  }
  return OTTO_TOOL_GROUPS.filter((group) => selected.has(group));
}

/**
 * Project a current selection back into the pre-split taxonomy for the legacy
 * key we keep writing. "agents" stands in for the whole family, so a peer that
 * predates the split still grants the tools the user left enabled rather than
 * withholding them.
 */
export function toLegacyOttoToolGroups(groups: readonly OttoToolGroup[]): OttoToolGroup[] {
  const selected = new Set<OttoToolGroup>(
    groups.filter((group) => LEGACY_OTTO_TOOL_GROUP_SET.has(group)),
  );
  if (groups.some((group) => AGENTS_DERIVED_TOOL_GROUP_SET.has(group))) {
    selected.add("agents");
  }
  return LEGACY_OTTO_TOOL_GROUPS.filter((group) => selected.has(group));
}

/**
 * Read a persisted selection that may be in either taxonomy.
 *
 * COMPAT(ottoToolGroupsV2): added in v0.8.20. The v2 key wins when present; the
 * legacy key is migrated forward otherwise. A second key rather than a
 * heuristic, because the two shapes are genuinely ambiguous - "no new groups
 * listed" reads as "pre-split config" one way and "the user turned all seven
 * off" the other, and silently re-enabling tools somebody disabled is the worse
 * way to be wrong. Drop the legacy branch when the floor is >= v0.8.20.
 */
export function resolveStoredOttoToolGroups(input: {
  v2?: unknown;
  legacy?: unknown;
}): OttoToolGroup[] | undefined {
  const v2 = normalizeOttoToolGroups(input.v2);
  if (v2) {
    return v2;
  }
  const legacy = normalizeOttoToolGroups(input.legacy);
  return legacy ? expandLegacyOttoToolGroups(legacy) : undefined;
}

/** Both persisted shapes for one selection: the current key and its legacy projection. */
export function serializeOttoToolGroups(groups: readonly OttoToolGroup[]): {
  toolGroups: OttoToolGroup[];
  toolGroupsV2: OttoToolGroup[];
} {
  const normalized = OTTO_TOOL_GROUPS.filter((group) => groups.includes(group));
  return { toolGroups: toLegacyOttoToolGroups(normalized), toolGroupsV2: normalized };
}

interface OttoToolGroupRule {
  group: OttoToolGroup;
  /** Whole families share a prefix (preview_, browser_). */
  prefixes?: readonly string[];
  /** A substring the whole family shares, so later additions route themselves. */
  contains?: readonly string[];
  /** Exact names, where the family is one or two tools with nothing in common. */
  names?: readonly string[];
}

/**
 * Ordered: the first matching rule wins, so a name that could satisfy two rules
 * resolves the same way every time. Prefer a shared substring over an exact-name
 * list, so a tool added later lands in its category without a second edit here.
 */
const OTTO_TOOL_GROUP_RULES: readonly OttoToolGroupRule[] = [
  { group: "preview", prefixes: ["preview_"] },
  { group: "browser", prefixes: ["browser_"] },
  { group: "web", names: ["web_search", "web_fetch"] },
  { group: "terminals", contains: ["terminal"] },
  // "heartbeat" rather than just create_heartbeat: delete_heartbeat used to fall
  // through to the catch-all, so switching Schedules off left an agent able to
  // delete heartbeats it could no longer create.
  { group: "schedules", contains: ["schedule", "heartbeat"] },
  { group: "artifacts", contains: ["artifact"] },
  { group: "widgets", names: ["show_widget", "widget_contract"] },
  { group: "workspace", contains: ["worktree", "workspace"] },
  { group: "orchestration", contains: ["orchestration", "workflow"] },
  { group: "knowledge", contains: ["project_"] },
  { group: "memory", contains: ["lesson"] },
  { group: "permissions", contains: ["permission"] },
  { group: "tasks", contains: ["task"] },
  // "model" must stay below the rules above it: it is one character from
  // matching set_chat_mode, which belongs to the chat family.
  { group: "providers", contains: ["provider", "model"] },
  { group: "voice", names: ["speak"] },
];

/**
 * Map a tool name to its group. Covers both Otto's catalog tools and the
 * openai-compat builtin web tools (web_search/web_fetch → "web").
 *
 * "agents" is still the fallback, but it now means what it says - spawning and
 * steering chats - instead of "everything not otherwise classified". It used to
 * collect 43 of the catalog's 72 tools, which made it impossible to switch off
 * one capability without losing six unrelated ones.
 */
export function ottoToolGroupForName(name: string): OttoToolGroup {
  for (const rule of OTTO_TOOL_GROUP_RULES) {
    if (rule.prefixes?.some((prefix) => name.startsWith(prefix))) return rule.group;
    if (rule.names?.includes(name)) return rule.group;
    if (rule.contains?.some((fragment) => name.includes(fragment))) return rule.group;
  }
  return "agents";
}

const McpStdioServerConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
});

const McpHttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
});

const McpSseServerConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
});

/**
 * Canonical MCP server config. Shared by AgentSessionConfig (per-agent servers
 * sent at create time) and ProviderOverride (provider-level servers in the
 * daemon config). stdio entries execute arbitrary commands as the daemon user -
 * both sources sit behind existing trust boundaries (daemon-side config file,
 * authenticated agent-create RPC).
 */
export const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
]);

/**
 * OAuth tokens held for a connector whose MCP server authenticates over OAuth
 * 2.1 (the "log in, don't paste a token" path). Mirrors the SDK's OAuthTokens
 * shape. Secret-bearing, so it is host-owned like every other credential in
 * daemon config and is redacted before the config is sent to a client.
 *
 * `expiresAt` is absolute epoch MILLISECONDS, not the `expires_in` duration the
 * token endpoint returns: a duration is only meaningful next to the instant it
 * was issued, and that instant is not on the wire.
 */
export const ConnectorOAuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().optional(),
  refreshToken: z.string().optional(),
  scope: z.string().optional(),
  expiresAt: z.number().optional(),
});

/**
 * The OAuth client identity this daemon registered with a connector's
 * authorization server, kept so a second login reuses the registration instead
 * of re-running dynamic client registration. Keyed alongside the redirect URI it
 * was registered against: if the loopback port moves, the registration is stale
 * and must be redone.
 */
export const ConnectorOAuthClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string().min(1),
});

/**
 * Everything the daemon persists about a connector's authorization. Absent means
 * the connector either needs no credential or carries a static token in its
 * transport (env var for stdio, Authorization header for http/sse) - this block
 * is only for the interactive OAuth path.
 */
export const ConnectorAuthStateSchema = z.object({
  kind: z.literal("oauth"),
  tokens: ConnectorOAuthTokensSchema.optional(),
  client: ConnectorOAuthClientSchema.optional(),
  /** Account label shown in the UI once connected (email / workspace name). */
  account: z.string().optional(),
  /** Epoch ms of the last successful authorization; drives "Connected on ...". */
  authorizedAt: z.number().optional(),
});

/**
 * Per-workspace state for a connector, keyed by workspace cwd in
 * ConnectorConfig.workspaces. Phase 1 leaves this inert (the daemon does not
 * yet read it); it exists in the schema now so per-workspace scope can land
 * later without a config migration.
 */
export const ConnectorWorkspaceStateSchema = z.object({
  /** false = this connector is switched off for this workspace. Absent = enabled. */
  enabled: z.boolean().optional(),
});

/**
 * A Connector is an MCP server surfaced to users as a first-class, named,
 * enable/disable-able integration. Mechanism is plain MCP (it embeds a
 * McpServerConfig transport descriptor unchanged); what makes it a "connector"
 * is the lifecycle state layered on top: a global on/off, an individually
 * disabled-tools list, and (later) per-workspace activation. Every state field
 * is optional so an absent value reads as "enabled / nothing disabled", keeping
 * old configs and old daemons behaving exactly as before.
 */
export const ConnectorConfigSchema = z.object({
  /** Stable key; doubles as the MCP server name used by the tool namespacer. */
  id: z.string().min(1),
  /** Human-facing name shown in the Connectors UI. Falls back to id when absent. */
  label: z.string().optional(),
  /** The MCP transport this connector connects over. */
  server: McpServerConfigSchema,
  /** Global on/off. Absent = enabled. false = never connected, no tools exposed. */
  enabled: z.boolean().optional(),
  /** Tool names (unqualified, as the server reports them) withheld from the model. */
  disabledTools: z.array(z.string()).optional(),
  /**
   * OAuth authorization state, when this connector logs in rather than taking a
   * pasted token. Optional so every existing connector parses unchanged.
   */
  auth: ConnectorAuthStateSchema.optional(),
  /** Per-workspace activation keyed by workspace cwd. Phase 2; inert today. */
  workspaces: z.record(z.string(), ConnectorWorkspaceStateSchema).optional(),
  /** Display ordering in the UI; lower sorts first. */
  order: z.number().optional(),
});

/**
 * The daemon-wide connector registry, persisted at daemon.connectors in
 * $OTTO_HOME/config.json. Host-owned like every other secret-bearing capability.
 */
export const ConnectorsConfigSchema = z.object({
  connectors: z.array(ConnectorConfigSchema).optional(),
});

/**
 * How natively-hosted providers (openai-compat) gate MCP tool calls in
 * acceptEdits mode. "always-ask" (the default) prompts for every MCP tool;
 * "trust-read-only" auto-approves tools whose MCP readOnlyHint annotation is
 * true. In default mode every MCP tool prompts regardless; plan mode never
 * exposes MCP tools; bypassPermissions auto-approves everything.
 */
export const MCP_TOOL_PERMISSION_MODES = ["always-ask", "trust-read-only"] as const;

/**
 * Auto-compaction thresholds selectable for daemon-hosted compaction
 * (openai-compat): percentage of the model's context window at which the
 * conversation is compacted automatically.
 */
export const COMPACTION_THRESHOLD_PERCENTS = [50, 60, 70, 80, 90] as const;

/**
 * Max model→tool→model rounds per turn for providers whose tool loop the
 * daemon owns (openai-compat). The turn stops with an error after this many
 * rounds without a final answer - a runaway-loop safety valve, most often hit
 * by smaller local models that keep calling tools instead of converging.
 * Bounds keep the setting a sane guard rail rather than an off switch.
 */
export const MAX_TOOL_ROUNDS_DEFAULT = 50;
export const MAX_TOOL_ROUNDS_MIN = 1;
export const MAX_TOOL_ROUNDS_MAX = 1000;

/**
 * Action circuit-breaker for daemon-hosted tool loops (openai-compat /
 * Otto Brain). When enabled, an action (tool name + exact arguments) that
 * fails this many times in a row stops being executed: the rest of the
 * round's identical calls are dropped, and a repair prompt is sent to the
 * model explaining what failed and how to change course. Small local models
 * can degenerate into emitting the same broken action hundreds of times per
 * round (the 2,912-call browser_navigate({}) incident); without the breaker
 * each identical failure is appended to the conversation verbatim until the
 * context window is blown and the turn dies. Defaults are safe for every
 * model; bounds keep the setting a guard rail, not an off switch.
 */
export const ACTION_BREAKER_DEFAULT_THRESHOLD = 5;
export const ACTION_BREAKER_MIN_THRESHOLD = 2;
export const ACTION_BREAKER_MAX_THRESHOLD = 100;

/**
 * Tool-emission stall guard (daemon-wide, provider-agnostic). A healthy agent
 * turn either acts - it emits a tool call - or it hands back to the human. An
 * assistant message that does neither has no side effect, so a run that only
 * produces those is not working, it is stuck. This is the count of consecutive
 * such messages tolerated before the daemon interrupts the run.
 *
 * Purely structural: it counts stream events, never their text. A tool call
 * resets it to zero, so a long working loop (a 200-turn investigation with a
 * tool call every few turns) can never trip it; so does a real user prompt, so
 * ordinary back-and-forth chat can never trip it either.
 *
 * `0` disables the guard. Bounds keep the setting a guard rail rather than a
 * hair trigger. See agent-stall-guard.ts and the "unbounded tool-call
 * announcement" finding: a local model emitted ~840 consecutive text-only
 * messages over five minutes, re-announcing three tool calls it never sent, and
 * nothing in the runtime noticed.
 */
export const STALL_GUARD_DEFAULT_THRESHOLD = 15;
export const STALL_GUARD_MIN_THRESHOLD = 3;
export const STALL_GUARD_MAX_THRESHOLD = 500;

/**
 * Per-round assistant-text budget for daemon-hosted tool loops (openai-compat /
 * Otto Brain). The same invariant the stall guard enforces across messages, held
 * *within* one: a model round that has streamed this much prose while emitting
 * no tool call is neither acting nor finishing, so the turn is interrupted.
 *
 * This is the sibling STALL_GUARD_* cannot cover. That counter keys on
 * `messageId` so a message streamed as a burst of deltas counts once - correct,
 * and the reason it reads 1 for a *single* runaway generation. In the
 * "unbounded tool-call announcement" incident the model produced 66,384
 * characters inside one completion over 5m40s, never emitting a stop token and
 * never emitting a tool call; the run ended only because the user typed
 * /compact. Counting characters within the round is what catches that shape.
 *
 * Structural, not textual: it measures how much was produced, never what was
 * said. Reasoning/thinking text is deliberately excluded - high-effort thinking
 * is legitimately long, and the degeneration this bounds is in content.
 *
 * The default is far above any real answer (roughly 8K tokens of prose in one
 * round), so it is a safety valve rather than a style limit. `0` disables it.
 */
export const MAX_ROUND_TEXT_CHARS_DEFAULT = 32_000;
export const MAX_ROUND_TEXT_CHARS_MIN = 2_000;
export const MAX_ROUND_TEXT_CHARS_MAX = 2_000_000;

/**
 * Compaction tuning for providers whose conversation the daemon owns
 * (openai-compat). These set the provider-level defaults; the per-agent
 * "Auto-compact" feature select overrides them at runtime.
 */
export const ProviderCompactionConfigSchema = z.object({
  /** false disables auto-compaction by default for new agents (manual /compact stays). */
  autoCompact: z.boolean().optional(),
  /** Context-window percentage at which auto-compaction triggers. Default 80. */
  thresholdPercent: z
    .union([z.literal(50), z.literal(60), z.literal(70), z.literal(80), z.literal(90)])
    .optional(),
  /** Recent-conversation budget kept verbatim through compaction. Default 20000. */
  keepRecentTokens: z.number().int().positive().optional(),
  /** Maximum tokens the compaction summary may generate. Omitted leaves the endpoint default. */
  summaryMaxTokens: z.number().int().positive().optional(),
  /**
   * true hides the per-agent "Auto-compact" feature select in chats; agents
   * always run with the provider-level default above (persisted per-agent
   * values are ignored while hidden).
   */
  hideSelector: z.boolean().optional(),
});

export type ProviderCompactionConfig = z.infer<typeof ProviderCompactionConfigSchema>;

/**
 * Action circuit-breaker tuning for daemon-hosted tool loops (openai-compat /
 * Otto Brain). When enabled, an action that fails `threshold` times in a row
 * (same tool name + same arguments) stops being executed for the rest of the
 * round, and the model receives a repair prompt instead of a dead-end error.
 * Omitted or `enabled: false` keeps the historical behavior: every tool call
 * the model emits is executed, failures and all.
 */
export const ProviderActionBreakerConfigSchema = z.object({
  /** false (default) disables the breaker; true enables it. */
  enabled: z.boolean().optional(),
  /**
   * Consecutive identical failures before the breaker trips.
   * Default ACTION_BREAKER_DEFAULT_THRESHOLD (5), clamped to [MIN, MAX].
   */
  threshold: z
    .number()
    .int()
    .min(ACTION_BREAKER_MIN_THRESHOLD)
    .max(ACTION_BREAKER_MAX_THRESHOLD)
    .optional(),
});

export type ProviderActionBreakerConfig = z.infer<typeof ProviderActionBreakerConfigSchema>;

export const ProviderOverrideSchema = z.object({
  extends: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  models: z.array(ProviderProfileModelSchema).optional(),
  additionalModels: z.array(ProviderProfileModelSchema).optional(),
  disallowedTools: z.array(z.string()).optional(),
  /**
   * Which Otto tool groups to inject for this provider (natively-injected
   * providers only). Omitted = all groups. Empty array = no Otto tools.
   *
   * COMPAT(ottoToolGroupsV2): added in v0.8.20. `ottoToolGroups` is the legacy
   * projection kept for older peers; `ottoToolGroupsV2` is authoritative. Both
   * are `string[]` rather than an enum so an older peer drops group names it
   * does not know instead of failing to parse the provider entry - read them
   * through resolveStoredOttoToolGroups, never directly.
   */
  ottoToolGroups: z.array(z.string().min(1)).optional(),
  ottoToolGroupsV2: z.array(z.string().min(1)).optional(),
  /**
   * MCP servers for providers whose tool loop the daemon hosts (openai-compat).
   * Merged with any per-agent AgentSessionConfig.mcpServers; the per-agent
   * entry wins on a server-name collision.
   */
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
  mcpToolPermissions: z.enum(MCP_TOOL_PERMISSION_MODES).optional(),
  /**
   * Compaction defaults for providers whose conversation the daemon owns
   * (openai-compat). Per-agent feature values win over these.
   */
  compaction: ProviderCompactionConfigSchema.optional(),
  /**
   * Max model→tool→model rounds per turn for daemon-hosted providers
   * (openai-compat). Omitted = the built-in default (MAX_TOOL_ROUNDS_DEFAULT).
   */
  maxToolRounds: z.number().int().min(MAX_TOOL_ROUNDS_MIN).max(MAX_TOOL_ROUNDS_MAX).optional(),
  /**
   * Action circuit-breaker for daemon-hosted tool loops (openai-compat /
   * Otto Brain). Stops a repeatedly-failing identical action and repairs
   * instead of re-executing it. Omitted = disabled (historical behavior).
   */
  actionBreaker: ProviderActionBreakerConfigSchema.optional(),
  /**
   * Assistant-text budget for one model round (openai-compat / Otto Brain).
   * A round that streams past this many characters without emitting a tool call
   * interrupts the turn. Omitted = MAX_ROUND_TEXT_CHARS_DEFAULT; `0` disables.
   */
  maxRoundTextChars: z
    .union([
      z.literal(0),
      z.number().int().min(MAX_ROUND_TEXT_CHARS_MIN).max(MAX_ROUND_TEXT_CHARS_MAX),
    ])
    .optional(),
  /**
   * Whether the daemon-hosted tool loop (openai-compat / Otto Brain) may add
   * context to a conversation after it has started. Today that is the
   * subdirectory instruction file loaded when the agent first touches a subtree;
   * anything else the loop wants to inject mid-conversation rides under the same
   * switch. Omitted = true (the shipped behavior). Turn it off for a small local
   * context window, where a few thousand tokens arriving unannounced mid-task
   * costs more than the rules are worth. Providers whose conversation Otto does
   * not own (every ACP/CLI provider) are unaffected either way.
   */
  midSessionContextUpdates: z.boolean().optional(),
  enabled: z.boolean().optional(),
  order: z.number().optional(),
});

const BUILTIN_PROVIDER_IDS = ["claude", "codex", "copilot", "opencode", "pi", "omp"] as const;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ProviderOverridesSchema = z
  .record(z.string(), ProviderOverrideSchema)
  .superRefine((providers, ctx) => {
    // otto-brain is builtin (endpoint comes from brain settings, not
    // extends/label) but not a valid `extends` target for a custom provider,
    // so it's added only here rather than to BUILTIN_PROVIDER_IDS itself.
    const builtinProviderIdSet = new Set<string>([...BUILTIN_PROVIDER_IDS, OTTO_BRAIN_PROVIDER_ID]);
    // "acp" spawns a generic ACP agent process; "openai-compatible" is served
    // natively by the daemon against an OpenAI-compatible HTTP endpoint
    // (LM Studio, Ollama, vLLM, ...) - no external binary involved.
    const validExtendsValues = new Set<string>([
      ...BUILTIN_PROVIDER_IDS,
      "acp",
      "openai-compatible",
    ]);

    for (const [providerId, provider] of Object.entries(providers)) {
      if (!PROVIDER_ID_PATTERN.test(providerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId],
          message: `Provider ID "${providerId}" must match ${PROVIDER_ID_PATTERN}.`,
        });
      }

      const isBuiltinProvider = builtinProviderIdSet.has(providerId);
      if (!isBuiltinProvider && !provider.extends) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "extends"],
          message: `Custom provider "${providerId}" must declare extends.`,
        });
      }

      if (!isBuiltinProvider && !provider.label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "label"],
          message: `Custom provider "${providerId}" must declare label.`,
        });
      }

      if (provider.extends && !validExtendsValues.has(provider.extends)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "extends"],
          message: `Provider "${providerId}" extends unknown provider "${provider.extends}".`,
        });
      }

      if (provider.extends === "acp" && !provider.command) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId, "command"],
          message: `Provider "${providerId}" extending "acp" must declare command.`,
        });
      }
    }
  });

export const AgentProviderRuntimeSettingsMapSchema = z
  .record(z.string(), ProviderRuntimeSettingsSchema)
  .superRefine((providers, ctx) => {
    for (const providerId of Object.keys(providers)) {
      const parsedProviderId = AgentProviderSchema.safeParse(providerId);
      if (!parsedProviderId.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [providerId],
          message: `Invalid agent provider "${providerId}".`,
        });
      }
    }
  });

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ConnectorOAuthTokens = z.infer<typeof ConnectorOAuthTokensSchema>;
export type ConnectorOAuthClient = z.infer<typeof ConnectorOAuthClientSchema>;
export type ConnectorAuthState = z.infer<typeof ConnectorAuthStateSchema>;
export type ConnectorWorkspaceState = z.infer<typeof ConnectorWorkspaceStateSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type ConnectorsConfig = z.infer<typeof ConnectorsConfigSchema>;
export type McpToolPermissionMode = (typeof MCP_TOOL_PERMISSION_MODES)[number];
export type ProviderCommand = z.infer<typeof ProviderCommandSchema>;
export type ProviderRuntimeSettings = z.infer<typeof ProviderRuntimeSettingsSchema>;
export type ProviderProfileModel = z.infer<typeof ProviderProfileModelSchema>;
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type ProviderOverrides = z.infer<typeof ProviderOverridesSchema>;
export type AgentProviderRuntimeSettingsMap = Partial<
  Record<AgentProvider, ProviderRuntimeSettings>
>;
