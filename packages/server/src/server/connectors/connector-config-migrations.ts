import type { ConnectorConfig } from "@otto-code/protocol/provider-config";

/** Repair exact retired catalog endpoints before auth or tool discovery uses them. */
export function migrateConnectorEndpoints(connectors: ConnectorConfig[]): ConnectorConfig[] {
  return connectors.map((connector) => {
    // COMPAT(webflowEndpoint): added in v0.9.10; remove after 2027-03-13.
    // The old catalog pointed at Webflow's HTML landing page. Never retarget a
    // saved OAuth grant to another resource; the corrected entry needs consent.
    if (
      connector.server.type !== "http" ||
      !["https://mcp.webflow.com", "https://mcp.webflow.com/"].includes(connector.server.url)
    )
      return connector;
    const { auth: _oldGrant, ...rest } = connector;
    return { ...rest, server: { ...connector.server, url: "https://mcp.webflow.com/mcp" } };
  });
}
