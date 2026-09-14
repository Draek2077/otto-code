import type { ConnectorConfig } from "./provider-config.js";

/** Public routing metadata only. Publisher secrets and scopes are service-owned. */
export function hostedConnectorVendor(connector: Pick<ConnectorConfig, "server">): string | null {
  if (connector.server.type !== "http") return null;
  if (
    connector.server.url === "https://mcp.hubspot.com" ||
    connector.server.url === "https://mcp.hubspot.com/"
  )
    return "hubspot";
  return connector.server.url === "https://mcp.box.com" ||
    connector.server.url === "https://mcp.box.com/"
    ? "box"
    : null;
}

export const HOSTED_CONNECTOR_DISCLOSURE =
  "Otto handles sign-in through its shared service. Your host stores the connection. Review permissions and privacy details before approving access.";
