import { z } from "zod";
import type { AgentProvider } from "./agent-types.js";
import { AgentProviderSchema } from "./provider-manifest.js";

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
 * coarse — users pick groups, not individual tools.
 */
export const OTTO_TOOL_GROUPS = [
  "preview",
  "browser",
  "web",
  "agents",
  "terminals",
  "schedules",
  "workspace",
] as const;

export type OttoToolGroup = (typeof OTTO_TOOL_GROUPS)[number];

/**
 * Map a tool name to its group. Covers both Otto's catalog tools and the
 * openai-compat builtin web tools (web_search/web_fetch → "web"). Unknown/
 * lifecycle tools fall under "agents".
 */
export function ottoToolGroupForName(name: string): OttoToolGroup {
  if (name.startsWith("preview_")) return "preview";
  if (name.startsWith("browser_")) return "browser";
  if (name === "web_search" || name === "web_fetch") return "web";
  if (name.includes("terminal")) return "terminals";
  if (name.includes("schedule") || name === "create_heartbeat") return "schedules";
  if (name.includes("worktree") || name.includes("workspace")) return "workspace";
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
 * daemon config). stdio entries execute arbitrary commands as the daemon user —
 * both sources sit behind existing trust boundaries (daemon-side config file,
 * authenticated agent-create RPC).
 */
export const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
]);

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
  /**
   * true hides the per-agent "Auto-compact" feature select in chats; agents
   * always run with the provider-level default above (persisted per-agent
   * values are ignored while hidden).
   */
  hideSelector: z.boolean().optional(),
});

export type ProviderCompactionConfig = z.infer<typeof ProviderCompactionConfigSchema>;

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
   */
  ottoToolGroups: z.array(z.enum(OTTO_TOOL_GROUPS)).optional(),
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
  enabled: z.boolean().optional(),
  order: z.number().optional(),
});

const BUILTIN_PROVIDER_IDS = ["claude", "codex", "copilot", "opencode", "pi", "omp"] as const;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ProviderOverridesSchema = z
  .record(z.string(), ProviderOverrideSchema)
  .superRefine((providers, ctx) => {
    const builtinProviderIdSet = new Set<string>(BUILTIN_PROVIDER_IDS);
    // "acp" spawns a generic ACP agent process; "openai-compatible" is served
    // natively by the daemon against an OpenAI-compatible HTTP endpoint
    // (LM Studio, Ollama, vLLM, ...) — no external binary involved.
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
export type McpToolPermissionMode = (typeof MCP_TOOL_PERMISSION_MODES)[number];
export type ProviderCommand = z.infer<typeof ProviderCommandSchema>;
export type ProviderRuntimeSettings = z.infer<typeof ProviderRuntimeSettingsSchema>;
export type ProviderProfileModel = z.infer<typeof ProviderProfileModelSchema>;
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type ProviderOverrides = z.infer<typeof ProviderOverridesSchema>;
export type AgentProviderRuntimeSettingsMap = Partial<
  Record<AgentProvider, ProviderRuntimeSettings>
>;
