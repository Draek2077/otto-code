import type { Logger } from "pino";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import { OpenAICompatMcpManager } from "../agent/providers/openai-compat-mcp.js";
import { createConnectorAuthProvider, type ConnectorAuthStore } from "./connector-oauth.js";
import { getConnectorAuthStore } from "./connector-auth-store.js";

export interface ConnectorToolInfo {
  name: string;
  description: string | null;
  disabled: boolean;
}

export interface ListConnectorToolsResult {
  tools: ConnectorToolInfo[];
  error: string | null;
}

export interface ListConnectorToolsDeps {
  cwd: string;
  logger?: Logger;
  managedProcesses?: ManagedProcessRegistry | null;
  /** Overrides the daemon-installed store; tests pass a memory store here. */
  authStore?: ConnectorAuthStore;
}

/**
 * Connect to a single connector's MCP server, enumerate every tool it exposes,
 * and mark each one disabled per the connector's config. Enumeration lists the
 * full surface (disabled tools included, flagged) so the settings UI can offer a
 * per-tool toggle - this is deliberately not the same filtering the agent path
 * applies, which withholds disabled tools entirely.
 *
 * The manager is short-lived: it connects, snapshots, and is closed before this
 * returns, so no process outlives the request.
 */
export async function listConnectorTools(
  connector: ConnectorConfig,
  deps: ListConnectorToolsDeps,
): Promise<ListConnectorToolsResult> {
  // A signed-in connector must be enumerated WITH its token, or verification
  // reports 401 for a connector that actually works.
  const store = deps.authStore ?? getConnectorAuthStore();
  const authProvider = store ? createConnectorAuthProvider({ connector, store }) : undefined;
  const manager = new OpenAICompatMcpManager({
    servers: { [connector.id]: connector.server },
    providerId: "connectors",
    cwd: deps.cwd,
    logger: deps.logger,
    managedProcesses: deps.managedProcesses ?? null,
    ...(authProvider ? { authProviders: { [connector.id]: authProvider } } : {}),
    // No disabledTools here: enumeration must surface the whole surface so the
    // UI can toggle each tool, disabled ones included.
  });
  try {
    await manager.ensureConnected();
    const failure = manager.failures[0];
    const disabled = new Set(connector.disabledTools ?? []);
    const tools = manager.getToolBindings().map((binding) => ({
      name: binding.toolName,
      description: binding.description.length > 0 ? binding.description : null,
      disabled: disabled.has(binding.toolName),
    }));
    return { tools, error: failure ? failure.error : null };
  } catch (error) {
    return { tools: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    await manager.close();
  }
}
