import type { AgentProvider } from "@otto-code/protocol/agent-types";

interface ImportAgentInputBase {
  cwd?: string;
  /**
   * Workspace the import was requested from. Supply it whenever the caller has
   * one, so the imported session lands in that workspace instead of the daemon
   * resolving (or minting) another workspace for the same directory.
   */
  workspaceId?: string;
  labels?: Record<string, string>;
}

export type ImportAgentInput =
  | (ImportAgentInputBase & {
      providerId: string;
      providerHandleId: string;
    })
  | (ImportAgentInputBase & {
      provider: AgentProvider;
      sessionId: string;
    });
