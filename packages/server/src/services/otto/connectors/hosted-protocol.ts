import { z } from "zod";
import type { ConnectorBundle } from "./configuration.js";
import { ConnectorError } from "./configuration.js";
import { connectorAuthorizationFetch } from "./oauth-session.js";

export const HostedTokens = z.object({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresAt: z.number().finite().positive(),
  scopes: z.array(z.string().max(200)).max(100),
});
const Identity = {
  origin: z.string().url(),
  vendorId: z.enum(["box", "hubspot"]),
  resourceUrl: z.string(),
  grantId: z.string().regex(/^[a-f0-9]{64}$/),
  proof: z.string().regex(/^[\w-]{43}$/),
};
export const HostedCredential = z.object({
  kind: z.literal("hosted-oauth-v1"),
  ...Identity,
  tokens: HostedTokens,
  account: z.string().max(320).nullable(),
  refreshBlocked: z.boolean().optional(),
});
export const HostedPending = z.object({
  kind: z.literal("hosted-pending-v1"),
  ...Identity,
  expiresAt: z.number().positive(),
});
export const HostedState = z.discriminatedUnion("kind", [HostedCredential, HostedPending]);
export type HostedState = z.infer<typeof HostedState>;
export type HostedCredential = z.infer<typeof HostedCredential>;
export function hostedConnectorVendor(
  bundle: Pick<ConnectorBundle, "server" | "client">,
): "box" | "hubspot" | null {
  if (bundle.server.type !== "http" || bundle.client) return null;
  if (["https://mcp.box.com", "https://mcp.box.com/"].includes(bundle.server.url)) return "box";
  return ["https://mcp.hubspot.com", "https://mcp.hubspot.com/"].includes(bundle.server.url)
    ? "hubspot"
    : null;
}

/** Existing publisher protocol: the host owns the possession proof and user
 * tokens. The shared HTTPS service owns confidential publisher credentials.
 */
export class HostedAuthorizationProtocol {
  constructor(
    private readonly configuredOrigin: string | undefined,
    private readonly fetcher?: typeof fetch,
  ) {}
  get origin(): string {
    const raw = this.configuredOrigin ?? "https://auth.otto-code.me";
    if (!raw)
      throw new ConnectorError("unavailable", "Hosted connector sign-in is disabled on this host.");
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new ConnectorError(
        "validation",
        "The host's connector authentication service must be an HTTPS origin.",
      );
    return url.origin;
  }
  async post(
    path: string,
    body: unknown,
    proof?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await connectorAuthorizationFetch(this.fetcher, signal)(this.origin + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(proof ? { Authorization: `Bearer ${proof}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new ConnectorError(
          "vendor",
          `The sign-in service rejected this request (HTTP ${response.status}). Review the connection before trying again.`,
        );
      const text = await response.text();
      if (Buffer.byteLength(text) > 100000)
        throw new ConnectorError("vendor", "The sign-in service returned an oversized response.");
      return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "uncertain",
        "The sign-in service did not complete this request. Reload the connection before trying again.",
      );
    }
  }
}
