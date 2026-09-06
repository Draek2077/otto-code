import type { AgentSessionConfig } from "@otto-code/protocol/agent-types";
import type { CreateAgentRequestOptions } from "./daemon-client.js";
export function resolveAgentConfig(options: CreateAgentRequestOptions): AgentSessionConfig {
  const {
    config,
    provider,
    cwd,
    env: _env,
    workspaceId: _workspaceId,
    initialPrompt: _initialPrompt,
    images: _images,
    git: _git,
    worktreeName: _worktreeName,
    requestId: _requestId,
    labels: _labels,
    ...overrides
  } = options;

  const baseConfig: Partial<AgentSessionConfig> = {
    ...(provider ? { provider } : {}),
    ...(cwd ? { cwd } : {}),
    ...overrides,
  };

  const merged = config ? { ...baseConfig, ...config } : baseConfig;

  if (!merged.provider || !merged.cwd) {
    throw new Error("createAgent requires provider and cwd");
  }

  return {
    ...merged,
    provider: merged.provider,
    cwd: merged.cwd,
  };
}
