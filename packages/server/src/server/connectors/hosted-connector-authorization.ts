import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { hostedConnectorVendor } from "@otto-code/protocol/connector-hosted-auth";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import type { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import type { ConnectorAuthStore } from "./connector-oauth.js";
import { hostedConnectorAccount } from "./hosted-connector-account.js";

const INTEGRATION_ID = "connector-hosted-oauth";
const Tokens = z.object({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresAt: z.number().finite().positive(),
  scopes: z.array(z.string().max(200)).max(100),
});
const Credential = z.object({
  version: z.literal(1),
  origin: z.string().url(),
  vendorId: z.string(),
  resourceUrl: z.string(),
  grantId: z.string().regex(/^[a-f0-9]{64}$/),
  proof: z.string().regex(/^[\w-]{43}$/),
  tokens: Tokens,
});
type Credential = z.infer<typeof Credential>;
type PendingGrant = Omit<Credential, "tokens"> & { tokens?: Credential["tokens"] };

interface Options {
  authorization: IntegrationAuthorizationService;
  store: ConnectorAuthStore;
  readConnectors(): readonly ConnectorConfig[];
  origin?: string;
  fetcher?: typeof fetch;
  pollMs?: number;
}

// Matches the existing daemon-owned connector auth-store installation seam.
let installed: HostedConnectorAuthorization | undefined;
export function setHostedConnectorAuthorization(
  value: HostedConnectorAuthorization | undefined,
): void {
  installed = value;
}
export function getHostedConnectorAuthorization(): HostedConnectorAuthorization | undefined {
  return installed;
}

function serviceOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("OTTO_CONNECTOR_AUTH_URL must be an HTTPS origin.");
  return url.origin;
}

/** Owns one vault-backed connection per host/connector. No publisher secret,
 * code, proof, or vendor token is sent to a renderer or model provider.
 */
export class HostedConnectorAuthorization {
  private readonly origin: string | null;
  private readonly fetcher: typeof fetch;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly attempts = new Map<string, AbortController>();
  private readonly pendingGrants = new Map<string, PendingGrant>();
  private readonly completions = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, symbol>();
  private readonly secrets = new Map<string, string[]>();
  private closed = false;

  constructor(private readonly options: Options) {
    this.origin = serviceOrigin(options.origin);
    this.fetcher = options.fetcher ?? fetch;
  }

  get configured(): boolean {
    return this.origin !== null;
  }
  hasConnection(id: string): boolean {
    return (
      this.attempts.has(id) ||
      this.options.readConnectors().some((item) => item.id === id && !!hostedConnectorVendor(item))
    );
  }
  additionalSecrets(id: string): string[] {
    return this.secrets.get(id) ?? [];
  }
  private key(connectionId: string) {
    return { integrationId: INTEGRATION_ID, connectionId };
  }
  private connector(id: string): ConnectorConfig {
    const connector = this.options.readConnectors().find((item) => item.id === id);
    if (!connector || !hostedConnectorVendor(connector))
      throw new Error("This hosted connection was removed or its endpoint changed.");
    return connector;
  }
  private assertCurrent(id: string, generation: symbol): void {
    if (this.closed || this.generations.get(id) !== generation)
      throw new Error("This connection was disconnected or replaced.");
    this.connector(id);
  }
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => undefined);
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
      return undefined;
    });
    return result;
  }

  async start(id: string): Promise<{ status: "redirect"; authorizationUrl: string }> {
    if (!this.origin || this.closed)
      throw new Error("Hosted connector sign-in is not enabled on this host yet.");
    // Abort before waiting for an old poll/refresh; no later save can resurrect it.
    this.attempts.get(id)?.abort();
    const generation = Symbol();
    this.generations.set(id, generation);
    return this.serial(id, async () => {
      this.assertCurrent(id, generation);
      const connector = this.connector(id);
      if (connector.server.type === "stdio") throw new Error("A remote connector is required.");
      if ((await this.options.authorization.getVaultAvailability()).status !== "available")
        throw new Error("The host credential vault is unavailable. Unlock it before signing in.");
      // Reconnect revokes the previous grant first; failures keep the local grant
      // available for an explicit Disconnect and vendor-side revocation.
      const previous = (await this.read(id)) ?? this.pendingGrants.get(id);
      if (previous)
        await this.request(
          `/v1/grants/${previous.grantId}/revoke`,
          { refreshToken: previous.tokens?.refreshToken },
          previous.proof,
        );
      await this.options.authorization.deleteConnection(this.key(id));
      this.pendingGrants.delete(id);
      this.options.store.write(id, null);
      const proof = randomBytes(32).toString("base64url");
      const vendorId = hostedConnectorVendor(connector)!;
      const result = await this.request("/v1/grants", {
        vendorId,
        proofHash: createHash("sha256").update(proof).digest("base64url"),
      });
      const start = z
        .object({ grantId: z.string().regex(/^[a-f0-9]{64}$/), authorizationUrl: z.string().url() })
        .parse(result);
      if (start.authorizationUrl !== `${this.origin}/v1/grants/${start.grantId}/authorize`)
        throw new Error("The sign-in service returned an invalid address.");
      this.assertCurrent(id, generation);
      const controller = new AbortController();
      this.attempts.set(id, controller);
      const pending: PendingGrant = {
        version: 1,
        origin: this.origin!,
        vendorId,
        resourceUrl: connector.server.url,
        grantId: start.grantId,
        proof,
      };
      this.pendingGrants.set(id, pending);
      const completion = this.poll(id, generation, controller, pending);
      completion.catch(() => undefined);
      this.completions.set(id, completion);
      return { status: "redirect", authorizationUrl: start.authorizationUrl };
    });
  }

  waitForCompletion(id: string): Promise<void> {
    return this.completions.get(id) ?? Promise.reject(new Error("No sign-in attempt is active."));
  }

  private async poll(
    id: string,
    generation: symbol,
    controller: AbortController,
    partial: PendingGrant,
  ): Promise<void> {
    const deadline = Date.now() + 300_000;
    try {
      while (Date.now() < deadline) {
        await delay(this.options.pollMs ?? 2500, undefined, { signal: controller.signal });
        this.assertCurrent(id, generation);
        const response = await this.request(
          `/v1/grants/${partial.grantId}/collect`,
          {},
          partial.proof,
          controller.signal,
        );
        if (response.status === "pending") continue;
        const tokens = Tokens.parse(response.tokens);
        partial.tokens = tokens;
        const account = await hostedConnectorAccount(
          partial.vendorId,
          tokens.accessToken,
          this.fetcher,
        );
        await this.serial(id, async () => {
          this.assertCurrent(id, generation);
          await this.save(id, { ...partial, tokens }, account);
          // Disconnect invalidates the generation synchronously during vault I/O.
          this.assertCurrent(id, generation);
          this.options.store.write(id, {
            kind: "oauth",
            resourceUrl: partial.resourceUrl,
            hosted: { vendorId: partial.vendorId, connected: true, scopes: tokens.scopes },
            account,
            authorizedAt: Date.now(),
          });
          this.pendingGrants.delete(id);
        });
        return;
      }
      throw new Error("Sign-in timed out. Start again in Otto.");
    } catch {
      // A collect may already have consumed the code. Never replay after errors.
      if (this.generations.get(id) === generation) {
        await this.serial(id, async () => {
          if (this.generations.get(id) !== generation) return;
          await this.options.authorization.deleteConnection(this.key(id));
          this.options.store.write(id, null);
        });
      }
      throw new Error(
        "Sign-in did not finish. Start again in Otto. If access was approved, you can also remove Otto in the vendor's account settings.",
      );
    } finally {
      if (this.attempts.get(id) === controller) this.attempts.delete(id);
    }
  }

  private async save(id: string, value: Credential, accountLabel?: string): Promise<void> {
    this.secrets.set(id, [value.proof, value.tokens.accessToken, value.tokens.refreshToken]);
    await this.options.authorization.saveSecret({ ...this.key(id), value: JSON.stringify(value) });
    await this.options.authorization.saveConnectionMetadata({
      ...this.key(id),
      method: "oauth-pkce",
      state: "connected",
      grantedScopes: value.tokens.scopes,
      accountLabel: accountLabel ?? this.options.store.read(id)?.account,
      enabled: true,
    });
  }

  private async read(id: string, forRevocation = false): Promise<Credential | null> {
    const value = await this.options.authorization.readSecret(this.key(id));
    if (!value) return null;
    let parsed: Credential;
    try {
      parsed = Credential.parse(JSON.parse(value));
    } catch {
      throw new Error("The stored connection is invalid. Disconnect and sign in again.");
    }
    const connector = forRevocation
      ? { server: { type: "http" as const, url: parsed.resourceUrl } }
      : this.connector(id);
    if (
      parsed.origin !== this.origin ||
      parsed.vendorId !== hostedConnectorVendor(connector) ||
      connector.server.type === "stdio" ||
      parsed.resourceUrl !== connector.server.url
    )
      throw new Error(
        "The connection's service or endpoint changed. Restore its original configuration before disconnecting.",
      );
    this.secrets.set(id, [parsed.proof, parsed.tokens.accessToken, parsed.tokens.refreshToken]);
    return parsed;
  }

  private async accessToken(id: string): Promise<string> {
    const generation = this.generations.get(id) ?? Symbol();
    this.generations.set(id, generation);
    return this.serial(id, async () => {
      this.assertCurrent(id, generation);
      const connector = this.connector(id);
      if (connector.enabled === false || !connector.auth?.hosted?.connected)
        throw new Error("Connect this account in Settings before using its tools.");
      let value = await this.read(id);
      if (!value) throw new Error("Connect this account in Settings before using its tools.");
      if (value.tokens.expiresAt - 60_000 <= Date.now()) {
        try {
          const result = await this.request(
            `/v1/grants/${value.grantId}/refresh`,
            { refreshToken: value.tokens.refreshToken },
            value.proof,
          );
          value = { ...value, tokens: Tokens.parse(result.tokens) };
          this.assertCurrent(id, generation);
          await this.save(id, value);
        } catch {
          this.options.store.write(id, {
            kind: "oauth",
            resourceUrl: value.resourceUrl,
            hosted: { vendorId: value.vendorId, connected: false },
          });
          throw new Error(
            "Authorization renewal failed. Reconnect in Settings; if that fails, disconnect and remove Otto in the vendor's account settings.",
          );
        }
      }
      this.assertCurrent(id, generation);
      return value.tokens.accessToken;
    });
  }

  provider(connector: ConnectorConfig): OAuthClientProvider {
    const reconnect = () => {
      throw new Error("Reconnect this account in Otto Settings.");
    };
    return {
      get redirectUrl() {
        return undefined;
      },
      clientMetadata: { redirect_uris: [] },
      clientInformation: reconnect,
      tokens: async () => ({
        access_token: await this.accessToken(connector.id),
        token_type: "Bearer",
      }),
      saveTokens: reconnect,
      redirectToAuthorization: reconnect,
      saveCodeVerifier: reconnect,
      codeVerifier: reconnect,
    };
  }

  async disconnect(id: string): Promise<void> {
    this.generations.set(id, Symbol());
    this.attempts.get(id)?.abort();
    await this.serial(id, async () => {
      let revocationFailed = false;
      try {
        const value = (await this.read(id, true)) ?? this.pendingGrants.get(id);
        if (value)
          await this.request(
            `/v1/grants/${value.grantId}/revoke`,
            { refreshToken: value.tokens?.refreshToken },
            value.proof,
          );
      } catch {
        revocationFailed = true;
      }
      await this.options.authorization.deleteConnection(this.key(id));
      this.options.store.write(id, null);
      this.secrets.delete(id);
      this.pendingGrants.delete(id);
      this.completions.delete(id);
      if (revocationFailed)
        throw new Error(
          "Credentials removed from this host. Vendor revocation could not be confirmed. Remove Otto in the vendor's account settings to end its access.",
        );
    });
  }

  async reconcile(): Promise<void> {
    const records = await this.options.authorization.listConnections();
    const ids = new Set([
      ...records
        .filter((record) => record.integrationId === INTEGRATION_ID)
        .map((record) => record.connectionId),
      ...this.attempts.keys(),
    ]);
    await Promise.all(
      [...ids]
        .filter(
          (id) =>
            !this.options
              .readConnectors()
              .some((item) => item.id === id && hostedConnectorVendor(item)),
        )
        .map((id) => this.disconnect(id).catch(() => undefined)),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const attempt of this.attempts.values()) attempt.abort();
    await Promise.allSettled([...this.completions.values(), ...this.queues.values()]);
    this.secrets.clear();
  }

  private async request(
    path: string,
    body: unknown,
    proof?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!this.origin) throw new Error("Hosted connector sign-in is not enabled on this host yet.");
    try {
      const response = await this.fetcher(this.origin + path, {
        method: "POST",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
        headers: {
          "content-type": "application/json",
          ...(proof ? { authorization: `Bearer ${proof}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      // The service is publisher-controlled, still bound response size before parsing.
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 100_000) throw new Error();
          chunks.push(Buffer.from(next.value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new Error(
        "The sign-in service could not complete this request. Reconnect in Settings.",
      );
    }
  }
}
