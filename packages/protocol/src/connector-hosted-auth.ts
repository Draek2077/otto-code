import type { ConnectorConfig } from "./provider-config.js";

/** Public routing metadata only. Publisher secrets and scopes are service-owned. */
export function hostedConnectorVendor(connector: Pick<ConnectorConfig, "server">): string | null {
  if (connector.server.type !== "http") return null;
  return connector.server.url === "https://mcp.box.com" ||
    connector.server.url === "https://mcp.box.com/"
    ? "box"
    : null;
}

export const HOSTED_CONNECTOR_DISCLOSURE =
  "Otto's shared sign-in service exchanges and renews credentials and can read tokens while processing them. Your selected host stores tokens in its credential vault and calls the vendor directly. Sign-in codes expire after five minutes; connection proof hashes expire 90 days after renewal. Expired records are scheduled for deletion; infrastructure backups follow Cloudflare's retention policies. The service does not persist access or refresh tokens. Tool results may be sent to your selected AI provider.";
