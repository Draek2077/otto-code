import type { Options as ClaudeOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentLaunchContext, AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import type { WorkflowAgentRequest, WorkflowAgentBinding } from "./runtime-ports.js";
import { WorkflowError } from "./files.js";

export interface WorkflowLaunchPolicy {
  access: "write" | "read" | "none";
}
interface LaunchOwner {
  binding: (id: string) => WorkflowAgentBinding | null;
  active: (id: string) => boolean;
  controlsConductor?: (id: string) => boolean;
  family: (provider: string) => string | null;
}
const owners = new WeakMap<object, LaunchOwner>();
export function isControlledWorkflowConductor(manager: object, id: string): boolean {
  return owners.get(manager)?.controlsConductor?.(id) === true;
}
export function attachWorkflowLaunchOwner(manager: object, owner: LaunchOwner): () => void {
  owners.set(manager, owner);
  return () => {
    if (owners.get(manager) === owner) owners.delete(manager);
  };
}
const readFamilies = new Set(["claude", "codex", "opencode", "otto-openai"]);
function matchesCapturedSeat(config: AgentSessionConfig, request: WorkflowAgentRequest): boolean {
  return (
    config.provider === request.seat.provider &&
    config.model === request.seat.model &&
    config.cwd === request.workspace.cwd &&
    (request.seat.modeId === undefined || config.modeId === request.seat.modeId) &&
    (request.seat.thinkingOptionId === undefined ||
      config.thinkingOptionId === request.seat.thinkingOptionId)
  );
}
export function supportsWorkflowAccess(
  family: string | null,
  access: WorkflowAgentRequest["access"],
): boolean {
  if (access === "write") return true;
  if (access === "none") return family === "claude" || family === "otto-openai";
  return family !== null && readFamilies.has(family);
}
/** Apply after Paseo/plugin configuration resolution. Only an admitted, reserved agent receives this ceiling. */
export function prepareWorkflowLaunch(
  manager: object,
  config: AgentSessionConfig,
  context: AgentLaunchContext,
): AgentSessionConfig {
  const owner = owners.get(manager);
  const binding = context.agentId ? owner?.binding(context.agentId) : null;
  if (!binding) return config;
  if (!owner!.active(context.agentId!))
    throw new WorkflowError(
      "conflict",
      "Workflow launch authority was revoked during session startup.",
    );
  const request = binding.request;
  if (!matchesCapturedSeat(config, request))
    throw new WorkflowError(
      "conflict",
      "A launch customization changed this Workflow's captured provider/model/workspace. Review its configuration before starting again.",
    );
  const family = owner!.family(config.provider);
  if (!supportsWorkflowAccess(family, request.access))
    throw new WorkflowError(
      "unsupported",
      "This provider has no verified adapter for the declared Workflow workspace access.",
    );
  context.ottoWorkflowPolicy = { access: request.access };
  if (request.access === "write") {
    if (family === "codex")
      return {
        ...config,
        providerOptions: {
          ...config.providerOptions,
          features: { ...readObject(config.providerOptions?.features), multi_agent_v2: false },
        },
      };
    if (family === "opencode")
      return {
        ...config,
        providerOptions: {
          ...config.providerOptions,
          permission: { ...readObject(config.providerOptions?.permission), task: "deny" },
        },
      };
    return config;
  }
  // Unknown third-party MCP authority is never inferred from readOnlyHint. The filtered internal catalog remains available.
  const mcpServers = Object.fromEntries(
    Object.entries(config.mcpServers ?? {}).filter(([name]) => name === "paseo"),
  );
  const base = { ...config, mcpServers, toolPolicy: undefined };
  if (family === "otto-openai")
    return {
      ...base,
      modeId: "plan",
      providerOptions: { ...config.providerOptions, ottoWorkflowWorkspaceAccess: request.access },
    };
  if (family === "codex")
    return {
      ...base,
      providerOptions: {
        ...config.providerOptions,
        sandbox_mode: "read-only",
        approval_policy: "never",
        features: { ...readObject(config.providerOptions?.features), multi_agent_v2: false },
      },
    };
  if (family === "opencode")
    return {
      ...base,
      modeId: "plan",
      providerOptions: {
        permission: {
          read: "allow",
          glob: "allow",
          grep: "allow",
          list: "allow",
          edit: "deny",
          bash: "deny",
          task: "deny",
          repo_clone: "deny",
          skill: "deny",
          external_directory: "deny",
          webfetch: "ask",
          websearch: "ask",
          lsp: "deny",
        },
      },
    };
  return { ...base, modeId: "plan" };
}
function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
const readTools = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
const delegationTools = new Set(["Task", "Agent", "TaskCreate", "TaskUpdate"]);
/** Workflow tool ceiling, not startup-hook isolation. Ordinary Claude options are returned by identity. */
export function workflowClaudeOptions(
  options: ClaudeOptions,
  policy: WorkflowLaunchPolicy | undefined,
): ClaudeOptions {
  if (!policy) return options;
  const original = options.canUseTool;
  const readOnly = policy.access !== "write";
  const builtin = policy.access === "none" ? [] : [...readTools];
  return {
    ...options,
    ...(readOnly
      ? {
          tools: builtin,
          allowedTools: [],
          permissionMode: "default" as const,
          allowDangerouslySkipPermissions: false,
          strictMcpConfig: true,
        }
      : {}),
    disallowedTools: [...new Set([...(options.disallowedTools ?? []), ...delegationTools])],
    canUseTool: async (name, input, context) => {
      const internal = name.startsWith("mcp__paseo__");
      const allowed =
        !delegationTools.has(name) &&
        (!readOnly || internal || (policy.access === "read" && readTools.has(name)));
      if (!allowed)
        return {
          behavior: "deny",
          message:
            "This tool exceeds the Workflow's declared access or managed delegation boundary.",
        };
      return original ? original(name, input, context) : { behavior: "allow", updatedInput: input };
    },
  };
}
