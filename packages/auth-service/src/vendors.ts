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
  scopes: string;
  scopeDescription: string;
}

export interface VendorBindings {
  BOX_CLIENT_ID?: string;
  BOX_CLIENT_SECRET?: string;
}

export function resolveVendor(id: string, env: VendorBindings): Vendor | null {
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
