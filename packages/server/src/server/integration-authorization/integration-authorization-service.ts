import type {
  IntegrationAuthorizationMethod,
  IntegrationConnectionMetadata,
  IntegrationAuthorizationOverview,
} from "@otto-code/protocol/integration-authorization";
import { z } from "zod";
import type {
  CredentialVault,
  CredentialVaultAvailability,
  CredentialVaultKey,
} from "./credential-vault.js";
import type { IntegrationAuthorizationRegistry } from "./integration-authorization-registry.js";

export interface IntegrationAuthorizationServiceOptions {
  hostId: string;
  vault: CredentialVault;
  registry: IntegrationAuthorizationRegistry;
  now?: () => Date;
}

const OAuthTokenSetSchema = z.object({
  kind: z.literal("oauth-token-set-v1"),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  grantedScopes: z.array(z.string()),
});

/** Never safe to put on the wire. This record exists only inside the daemon vault. */
export type IntegrationOAuthTokenSet = Omit<z.infer<typeof OAuthTokenSetSchema>, "kind">;

export class IntegrationAuthorizationSecretError extends Error {
  constructor() {
    super("The stored integration credential is invalid. Reconnect the integration.");
    this.name = "IntegrationAuthorizationSecretError";
  }
}

export class IntegrationAuthorizationMethodChangeRequiresDisconnectError extends Error {
  constructor() {
    super("Disconnect this integration before choosing a different sign-in method.");
    this.name = "IntegrationAuthorizationMethodChangeRequiresDisconnectError";
  }
}

/**
 * Coordinates safe connection metadata with opaque vault entries. OAuth
 * drivers will own protocol-specific browser/callback work; this service owns
 * the common persistence and fail-closed credential boundary.
 */
export class IntegrationAuthorizationService {
  private readonly now: () => Date;

  constructor(private readonly options: IntegrationAuthorizationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await this.options.registry.initialize();
  }

  async getVaultAvailability(): Promise<CredentialVaultAvailability> {
    return this.options.vault.getAvailability();
  }

  async getConnection(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionMetadata | null> {
    return this.options.registry.get(params);
  }

  async listConnections(): Promise<IntegrationConnectionMetadata[]> {
    return this.options.registry.list();
  }

  async getOverview(): Promise<IntegrationAuthorizationOverview> {
    const [vault, connections] = await Promise.all([
      this.getVaultAvailability(),
      this.listConnections(),
    ]);
    return { vault, connections };
  }

  async saveConnectionMetadata(params: {
    integrationId: string;
    connectionId: string;
    method: IntegrationAuthorizationMethod;
    state: IntegrationConnectionMetadata["state"];
    accountLabel?: string | null;
    grantedScopes?: string[];
    errorCode?: string | null;
    enabled?: boolean;
  }): Promise<void> {
    const existing = await this.getConnection(params);
    await this.options.registry.upsert({
      integrationId: params.integrationId,
      connectionId: params.connectionId,
      method: params.method,
      state: params.state,
      accountLabel: params.accountLabel ?? null,
      grantedScopes: params.grantedScopes ?? [],
      updatedAt: this.now().toISOString(),
      errorCode: params.errorCode ?? null,
      enabled: params.enabled ?? existing?.enabled,
    });
  }

  /** Changes only nonsecret Otto availability. Credentials stay untouched. */
  async setConnectionEnabled(params: {
    integrationId: string;
    connectionId: string;
    enabled: boolean;
  }): Promise<IntegrationConnectionMetadata> {
    const connection = await this.getConnection(params);
    if (!connection) throw new Error("The integration connection was not found.");
    const updated: IntegrationConnectionMetadata = {
      ...connection,
      enabled: params.enabled,
      updatedAt: this.now().toISOString(),
    };
    await this.options.registry.upsert(updated);
    return updated;
  }

  /**
   * Records an initial sign-in method without accepting any credential. A
   * connected account must be explicitly disconnected first so selecting a new
   * method cannot silently orphan a working authorization.
   */
  async selectConnectionMethod(params: {
    integrationId: string;
    connectionId: string;
    method: IntegrationAuthorizationMethod;
  }): Promise<void> {
    const existing = await this.getConnection(params);
    if (existing?.state === "connected" && existing.method !== params.method) {
      throw new IntegrationAuthorizationMethodChangeRequiresDisconnectError();
    }
    if (existing?.method === params.method) return;
    await this.saveConnectionMetadata({
      integrationId: params.integrationId,
      connectionId: params.connectionId,
      method: params.method,
      state: "disconnected",
    });
  }

  async saveSecret(params: {
    integrationId: string;
    connectionId: string;
    value: string;
  }): Promise<void> {
    await this.options.vault.put(this.vaultKey(params), params.value);
  }

  async readSecret(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<string | null> {
    return this.options.vault.get(this.vaultKey(params));
  }

  async deleteConnection(params: { integrationId: string; connectionId: string }): Promise<void> {
    await Promise.all([
      this.options.vault.delete(this.vaultKey(params)),
      this.options.registry.remove(params),
    ]);
  }

  /**
   * Persists a complete OAuth token set as one opaque vault value and projects
   * only account/scopes/state into the nonsecret registry. Token JSON never
   * reaches a client or a daemon config file.
   */
  async saveOAuthTokenSet(params: {
    integrationId: string;
    connectionId: string;
    method: IntegrationAuthorizationMethod;
    tokens: IntegrationOAuthTokenSet;
    accountLabel?: string | null;
  }): Promise<void> {
    const secret = JSON.stringify({ kind: "oauth-token-set-v1", ...params.tokens });
    await this.saveSecret({
      integrationId: params.integrationId,
      connectionId: params.connectionId,
      value: secret,
    });
    try {
      await this.saveConnectionMetadata({
        integrationId: params.integrationId,
        connectionId: params.connectionId,
        method: params.method,
        state: "connected",
        accountLabel: params.accountLabel,
        grantedScopes: params.tokens.grantedScopes,
        enabled: true,
      });
    } catch (error) {
      await this.options.vault.delete(this.vaultKey(params)).catch(() => undefined);
      throw error;
    }
  }

  async readOAuthTokenSet(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<IntegrationOAuthTokenSet | null> {
    const secret = await this.readSecret(params);
    if (!secret) return null;
    const parsed = parseOAuthTokenSet(secret);
    if (!parsed) throw new IntegrationAuthorizationSecretError();
    const { kind: _kind, ...tokens } = parsed;
    return tokens;
  }

  private vaultKey(params: { integrationId: string; connectionId: string }): CredentialVaultKey {
    return {
      hostId: this.options.hostId,
      integrationId: params.integrationId,
      connectionId: params.connectionId,
    };
  }
}

function parseOAuthTokenSet(secret: string): z.infer<typeof OAuthTokenSetSchema> | null {
  try {
    const result = OAuthTokenSetSchema.safeParse(JSON.parse(secret));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
