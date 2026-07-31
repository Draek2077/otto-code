// Connectors settings helpers — pure config readers and whole-array patch
// builders over daemon config's `connectors`. A connector is an MCP server
// surfaced as a named, toggle-able integration; edits (add / remove / enable /
// disable / per-tool disable) are all read-modify-write of the full array,
// matching how modelTierOverrides and terminalProfiles patch.
//
// i18n: copy on this surface is English-only pending a translation pass
// (build-first, translate-last). Do not add locale keys here yet.
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import type { ConnectorConfig, McpServerConfig } from "@otto-code/protocol/provider-config";

export type ConnectorTransport = McpServerConfig["type"];

export function getConnectors(config: MutableDaemonConfig | null): ConnectorConfig[] {
  return config?.connectors ?? [];
}

// Absent `enabled` reads as enabled — the same default the daemon applies.
export function isConnectorEnabled(connector: ConnectorConfig): boolean {
  return connector.enabled !== false;
}

export function isConnectorToolDisabled(connector: ConnectorConfig, toolName: string): boolean {
  return connector.disabledTools?.includes(toolName) === true;
}

export function connectorExists(config: MutableDaemonConfig | null, id: string): boolean {
  return getConnectors(config).some((connector) => connector.id === id);
}

// Replace the whole array in one patch. Every builder below funnels through here
// so a patch is always a complete read-modify-write, never a partial merge.
function connectorsPatch(next: ConnectorConfig[]): MutableDaemonConfigPatch {
  return { connectors: next };
}

export function createAddConnectorPatch(
  config: MutableDaemonConfig | null,
  connector: ConnectorConfig,
): MutableDaemonConfigPatch {
  return connectorsPatch([...getConnectors(config), connector]);
}

export function createRemoveConnectorPatch(
  config: MutableDaemonConfig | null,
  id: string,
): MutableDaemonConfigPatch {
  return connectorsPatch(getConnectors(config).filter((connector) => connector.id !== id));
}

export function createSetConnectorEnabledPatch(
  config: MutableDaemonConfig | null,
  id: string,
  enabled: boolean,
): MutableDaemonConfigPatch {
  const next: ConnectorConfig[] = [];
  for (const connector of getConnectors(config)) {
    next.push(connector.id === id ? { ...connector, enabled } : connector);
  }
  return connectorsPatch(next);
}

export function createSetConnectorToolDisabledPatch(
  config: MutableDaemonConfig | null,
  id: string,
  toolName: string,
  disabled: boolean,
): MutableDaemonConfigPatch {
  const next: ConnectorConfig[] = [];
  for (const connector of getConnectors(config)) {
    if (connector.id !== id) {
      next.push(connector);
      continue;
    }
    const current = new Set(connector.disabledTools ?? []);
    if (disabled) {
      current.add(toolName);
    } else {
      current.delete(toolName);
    }
    next.push({ ...connector, disabledTools: [...current] });
  }
  return connectorsPatch(next);
}

// Build the transport descriptor for the add form. stdio splits the command
// string on whitespace (first token = command, rest = args); http/sse take a URL.
export function buildConnectorServer(params: {
  transport: ConnectorTransport;
  command: string;
  url: string;
}): McpServerConfig | null {
  if (params.transport === "stdio") {
    const parts = params.command.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    const [command, ...args] = parts;
    return args.length > 0 ? { type: "stdio", command, args } : { type: "stdio", command };
  }
  const url = params.url.trim();
  if (url.length === 0) {
    return null;
  }
  return params.transport === "http" ? { type: "http", url } : { type: "sse", url };
}
