import type { ConnectorConfig } from "@otto-code/protocol/provider-config";

export interface ConnectorOAuthRegistration {
  clientId: string;
  serverUrl: string;
  redirectUri: string;
  authorizationServerUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
  /** Vendor-required consent parameters, owned by the publisher registration. */
  authorizationParams?: Readonly<Record<string, string>>;
}

// Publisher-owned public identity, not a secret. Slack does not support DCR.
// Portal verified 2026-09-13: MCP enabled, PKCE enabled, these user scopes and
// this loopback redirect approved. Internal workspace access is verified;
// Marketplace publication is still required for general distribution.
// https://docs.slack.dev/ai/slack-mcp-server/
export const SLACK_OAUTH_REGISTRATION: ConnectorOAuthRegistration = {
  clientId: "12044001590499.12034876251863",
  serverUrl: "https://mcp.slack.com/mcp",
  redirectUri: "http://127.0.0.1:6871/connectors/oauth/callback",
  authorizationServerUrl: "https://mcp.slack.com",
  authorizationEndpoint: "https://slack.com/oauth/v2_user/authorize",
  tokenEndpoint: "https://slack.com/api/oauth.v2.user.access",
  // The official remote MCP server owns the operations and their scope map.
  // This is its portal-approved bundle, requested explicitly so discovery
  // cannot silently expand consent when Slack adds another scope.
  scopes: [
    "canvases:read",
    "canvases:write",
    "channels:history",
    "channels:read",
    "channels:write",
    "chat:write",
    "emoji:read",
    "files:read",
    "files:write",
    "groups:history",
    "groups:read",
    "groups:write",
    "im:history",
    "im:read",
    "im:write",
    "lists:read",
    "lists:write",
    "mpim:history",
    "mpim:read",
    "mpim:write",
    "reactions:read",
    "reactions:write",
    "search:read.files",
    "search:read.im",
    "search:read.mpim",
    "search:read.private",
    "search:read.public",
    "search:read.users",
    "users:read",
    "users:read.email",
  ],
};

export function getConnectorOAuthRegistration(
  connector: ConnectorConfig,
): ConnectorOAuthRegistration | undefined {
  // Identity follows the exact vendor endpoint, never a caller-chosen id/label.
  if (connector.server.type !== "http") return undefined;
  const serverUrl = connector.server.url;
  return [SLACK_OAUTH_REGISTRATION, DROPBOX_OAUTH_REGISTRATION].find(
    (registration) => registration.serverUrl === serverUrl,
  );
}

// Publisher-owned public app key, not a secret. Portal verified 2026-09-13:
// public clients/PKCE allowed, this loopback callback and these scopes enabled.
// Live owner-account consent, 25 tools, refresh and who_am_i verified. The app
// remains in Development with owner-only access; public distribution is unverified.
// https://help.dropbox.com/integrations/connect-dropbox-mcp-server
export const DROPBOX_OAUTH_REGISTRATION: ConnectorOAuthRegistration = {
  clientId: "ir4e1ixjf542mq8",
  serverUrl: "https://mcp.dropbox.com/mcp",
  redirectUri: "http://127.0.0.1:6872/connectors/oauth/callback",
  authorizationServerUrl: "https://www.dropbox.com",
  authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
  tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
  // Dropbox's MCP protected-resource metadata and app setup guide specify this bundle.
  scopes: [
    "account_info.read",
    "file_requests.read",
    "file_requests.write",
    "files.content.read",
    "files.content.write",
    "files.metadata.read",
    "sharing.read",
    "sharing.write",
  ],
  // Request refresh tokens so reconnecting is not required after access expiry.
  // https://developers.dropbox.com/oauth-guide
  authorizationParams: { token_access_type: "offline" },
};
