/** Publisher-owned allowlist. No endpoint, redirect, scope, or credential comes from callers. */
export interface Vendor {
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  authorizationRedirectOrigins?: readonly string[];
  tokenUrl: string;
  revokeUrl: string;
  revokeTokenTypeHint?: "refresh_token";
  /** null means the vendor's MCP consent UI owns the scope selection. */
  scopes: string | null;
  scopeDescription: string;
}

export interface VendorBindings {
  BOX_CLIENT_ID?: string;
  BOX_CLIENT_SECRET?: string;
  HUBSPOT_CLIENT_ID?: string;
  HUBSPOT_CLIENT_SECRET?: string;
}

export function resolveVendor(id: string, env: VendorBindings): Vendor | null {
  if (id === "hubspot" && env.HUBSPOT_CLIENT_ID && env.HUBSPOT_CLIENT_SECRET) {
    // MCP discovery verified 2026-09-13: client_secret_post, S256, no DCR.
    // https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server
    return {
      id,
      name: "HubSpot",
      clientId: env.HUBSPOT_CLIENT_ID,
      clientSecret: env.HUBSPOT_CLIENT_SECRET,
      authorizeUrl: "https://mcp.hubspot.com/oauth/authorize/user",
      authorizationRedirectOrigins: ["https://app.hubspot.com"],
      tokenUrl: "https://mcp.hubspot.com/oauth/v3/token",
      // https://developers.hubspot.com/docs/api-reference/latest/authentication/oauth-tokens/revoke-token
      revokeUrl: "https://api.hubapi.com/oauth/2026-09/token/revoke",
      revokeTokenTypeHint: "refresh_token",
      scopes: null,
      scopeDescription:
        "HubSpot data and actions you approve on the next screen, limited by your account permissions",
    };
  }
  if (id !== "box" || !env.BOX_CLIENT_ID || !env.BOX_CLIENT_SECRET) return null;
  return {
    id,
    name: "Box",
    clientId: env.BOX_CLIENT_ID,
    clientSecret: env.BOX_CLIENT_SECRET,
    authorizeUrl: "https://account.box.com/api/oauth2/authorize",
    // Signed-in Box accounts continue from account.box.com to app.box.com.
    authorizationRedirectOrigins: ["https://app.box.com"],
    tokenUrl: "https://api.box.com/oauth2/token",
    revokeUrl: "https://api.box.com/oauth2/revoke",
    scopes: "root_readwrite ai.readwrite",
    scopeDescription: "Content read/write and AI access",
  };
}
