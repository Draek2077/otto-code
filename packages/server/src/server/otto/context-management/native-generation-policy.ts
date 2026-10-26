import type { Options as ClaudeOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionConfig } from "../../agent/agent-sdk-types.js";

export const NATIVE_CONTEXT_OUTPUT_LIMIT = 262144;
export const NATIVE_CONTEXT_TIMEOUT_MS = 120000;
export const CONTEXT_GENERATION_SYSTEM_PROMPT =
  "Propose the requested prose changes using only the supplied working set. Do not modify files, invoke tools, start agents, or perform external actions. Return only the requested JSON.";

/** Runtime-only policies for a fresh utility session. Never mutate a saved chat/profile. */
export function nativeReadOnlyConfig(
  family: string,
  config: AgentSessionConfig,
): AgentSessionConfig {
  const base: AgentSessionConfig = {
    ...config,
    internal: true,
    mcpServers: {},
    toolPolicy: { preapproved: [] },
    systemPrompt: CONTEXT_GENERATION_SYSTEM_PROMPT,
    daemonAppendSystemPrompt: undefined,
  };
  switch (family) {
    case "claude":
      return { ...base, modeId: "plan" };
    case "codex":
      return {
        ...base,
        providerOptions: {
          approval_policy: "never",
          sandbox_mode: "read-only",
          web_search: "disabled",
          features: { multi_agent_v2: false },
        },
      };
    case "opencode":
      return { ...base, modeId: "plan", providerOptions: { permission: "deny" } };
    case "pi":
      return base;
    case "omp":
      return { ...base, modeId: "ask" };
    default:
      throw new Error("This provider has no enforced read-only utility policy.");
  }
}

/** Apply last, after all profile, custom-provider and runtime defaults. */
export function readOnlyClaudeOptions(options: ClaudeOptions): ClaudeOptions {
  return {
    ...options,
    tools: [],
    allowedTools: [],
    mcpServers: {},
    strictMcpConfig: true,
    permissionMode: "plan",
    allowDangerouslySkipPermissions: false,
    canUseTool: async () => ({
      behavior: "deny",
      message: "Tools are unavailable during reviewed Context generation.",
    }),
    settingSources: [],
    settings: { disableAllHooks: true },
    hooks: {},
    agents: {},
    plugins: [],
    extraArgs: {},
    enableFileCheckpointing: false,
    persistSession: false,
  };
}

/** Codex merges config maps: disable every discovered server explicitly, including profile additions. */
export function readOnlyCodexConfig(
  config: Record<string, unknown>,
  resolvedServers: readonly string[],
): Record<string, unknown> {
  const servers = config.mcp_servers;
  const names = new Set(resolvedServers);
  if (servers && typeof servers === "object" && !Array.isArray(servers))
    for (const name of Object.keys(servers)) names.add(name);
  return {
    ...config,
    approval_policy: "never",
    sandbox_mode: "read-only",
    web_search: "disabled",
    features: { multi_agent_v2: false },
    mcp_servers: Object.fromEntries([...names].map((name) => [name, { enabled: false }])),
  };
}

const TOOL_FLAGS = new Set([
  "--tools",
  "--extension",
  "-e",
  "--hooks",
  "--trusted-extensions",
  "--plugin-dir",
]);
/** A CLI profile cannot re-enable tools or inject executable extensions into this utility run. */
export function readOnlyPiArgs(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (TOOL_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if ([...TOOL_FLAGS].some((flag) => arg.startsWith(`${flag}=`))) continue;
    result.push(arg);
  }
  return [...result, "--no-tools", "--no-extensions", "--no-skills"];
}
