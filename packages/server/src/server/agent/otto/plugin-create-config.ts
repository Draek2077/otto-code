import type { AgentSessionConfig } from "../agent-sdk-types.js";
import type { PluginLifecycle } from "../../plugins/lifecycle/index.js";

/** Stable hooks own public launch configuration; Otto retains daemon-owned identity and policy. */
export async function applyPluginCreateConfig(
  config: AgentSessionConfig,
  env: Record<string, string> | undefined,
  lifecycle: Pick<PluginLifecycle, "before">,
): Promise<{ config: AgentSessionConfig; env?: Record<string, string> }> {
  const {
    profileSnapshot,
    teamSnapshot,
    workspaceAccess,
    unattended,
    observable,
    internal,
    daemonAppendSystemPrompt,
    ...publicConfig
  } = config;
  const request = await lifecycle.before("agent.create", { config: publicConfig, env });
  return {
    env: request.env,
    config: {
      ...request.config,
      profileSnapshot,
      teamSnapshot,
      workspaceAccess,
      unattended,
      observable,
      internal,
      daemonAppendSystemPrompt,
    },
  };
}
