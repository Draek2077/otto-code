import { z } from "zod";
import {
  auth,
  fetchToken,
  refreshAuthorization,
  selectResourceURL,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { readBody } from "@getpaseo/plugin/server/otto-openai";
import {
  ConnectorError,
  ConnectorBundleSchema,
  connectorEndpoint,
  disconnectedConnectorBundle,
  type ConnectorBundle,
} from "./configuration.js";
import { ConnectorStore, type ConnectorEntry } from "./store.js";
import {
  getConnectorOAuthRegistration,
  type ConnectorOAuthRegistration,
} from "./oauth-registration.js";

const Tokens = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().finite().optional(),
  scope: z.string().optional(),
});
const Client = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string(),
});
const Discovery = z.object({
  authorizationServerUrl: z.string(),
  authorizationServerMetadata: OAuthMetadataSchema.optional(),
  resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(),
  resourceMetadataUrl: z.string().optional(),
});
const State = z.object({
  kind: z.literal("oauth").optional(),
  resourceUrl: z.string().optional(),
  tokens: Tokens.optional(),
  client: Client.optional(),
  authorizedAt: z.number().optional(),
  discovery: Discovery.optional(),
  account: z.string().optional(),
  refreshBlocked: z.boolean().optional(),
});
type State = z.infer<typeof State>;
export interface ConnectorOAuthSessionOptions {
  store: Pick<ConnectorStore, "open" | "readBundleVersion" | "writeBundle">;
  entry: ConnectorEntry;
  bundle: ConnectorBundle;
  redirectUri: string;
  state: string;
  interactive: boolean;
  active(): boolean;
  onRedirect?(url: URL): void;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}

/** SDK-owned OAuth discovery, registration and PKCE. Redirects/codes remain
 * host-owned. The fetch boundary rejects redirects and caps response bodies.
 */
export function connectorAuthorizationFetch(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    connectorEndpoint(input instanceof Request ? input.url : String(input));
    const signals = [
      AbortSignal.timeout(30000),
      ...(signal ? [signal] : []),
      ...(init?.signal ? [init.signal] : []),
    ];
    const response = await fetcher(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any(signals),
    });
    return new Response(response.body ? await readBody(response) : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/** One captured grant generation, never a renderer-owned auth object. Quiet
 * sessions refresh existing grants but cannot register clients or open a browser.
 * Interactive registration stays staged until one successful code exchange.
 */
export class McpOAuthSession implements OAuthClientProvider {
  private grant: State;
  private bundle: ConnectorBundle;
  private revision: string;
  private verifier: string | null = null;
  private codeConsumed = false;
  private pending: Promise<unknown> = Promise.resolve();
  readonly registration: ConnectorOAuthRegistration | undefined;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private constructor(
    private readonly options: ConnectorOAuthSessionOptions,
    bundle: ConnectorBundle,
    revision: string,
  ) {
    this.bundle = bundle;
    this.revision = revision;
    this.registration = bundle.client ? undefined : getConnectorOAuthRegistration(bundle);
    this.grant =
      bundle.authorization?.kind === "disconnected" ? {} : State.parse(bundle.authorization ?? {});
    this.now = options.now ?? Date.now;
    this.fetcher = connectorAuthorizationFetch(options.fetcher, options.signal);
    if (bundle.server.type === "stdio")
      throw new ConnectorError("validation", "Browser sign-in requires an HTTP or SSE connector.");
    if (this.grant.resourceUrl && this.grant.resourceUrl !== bundle.server.url) this.grant = {};
    // COMPAT(connector09Grant): v0.10.0, remove after 2027-04-30. Only the
    // unchanged preserved transport may bind a legacy grant lacking resourceUrl.
    if (!this.grant.resourceUrl && this.grant.tokens) {
      if (bundle.legacy) this.grant.resourceUrl = bundle.server.url;
      else this.grant = {};
    }
    if (
      this.registration &&
      (this.grant.client?.clientId !== this.registration.clientId ||
        this.grant.client.clientSecret ||
        this.grant.client.redirectUri !== this.registration.redirectUri)
    )
      this.grant = {};
    if (options.interactive) this.grant = { ...this.grant, tokens: undefined };
  }

  static async open(options: ConnectorOAuthSessionOptions): Promise<McpOAuthSession> {
    const version = await options.store.readBundleVersion(options.entry);
    const bundle =
      version.value === null
        ? options.bundle
        : ConnectorBundleSchema.parse(JSON.parse(version.value));
    return new McpOAuthSession(options, bundle, version.revision);
  }
  private async assertActive(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (!this.options.active())
      throw new ConnectorError("conflict", "This sign-in attempt is no longer active.");
    const current = await this.options.store.open(this.options.entry.id);
    if (current.entry.generation !== this.options.entry.generation)
      throw new ConnectorError("conflict", "The connector changed. Start sign-in again.");
    const grant = await this.options.store.readBundleVersion(this.options.entry);
    if (grant.revision !== this.revision)
      throw new ConnectorError("conflict", "Authorization changed elsewhere. Start sign-in again.");
  }
  get redirectUrl(): string {
    return this.options.redirectUri;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Otto",
      client_uri: "https://otto-code.me",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.bundle.client?.clientSecret ? "client_secret_post" : "none",
    };
  }
  state(): string {
    return this.options.state;
  }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    await this.assertActive();
    if (this.registration) return { client_id: this.registration.clientId };
    if (this.bundle.client)
      return {
        client_id: this.bundle.client.clientId,
        ...(this.bundle.client.clientSecret
          ? { client_secret: this.bundle.client.clientSecret }
          : {}),
      };
    const stored = this.grant.client;
    if (stored && stored.redirectUri === this.redirectUrl)
      return {
        client_id: stored.clientId,
        ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}),
      };
    if (!this.options.interactive)
      throw new ConnectorError("authorization", "Sign in again from Settings > Connectors.");
    return undefined;
  }
  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.assertActive();
    if (!this.options.interactive || this.registration || this.bundle.client)
      throw new ConnectorError(
        "authorization",
        "This registered client cannot be replaced automatically. Start sign-in again.",
      );
    this.grant = {
      ...this.grant,
      client: {
        clientId: client.client_id,
        clientSecret: client.client_secret,
        redirectUri: this.redirectUrl,
      },
    };
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    await this.assertActive();
    const value = this.grant.tokens;
    if (!value) return undefined;
    return {
      access_token: value.accessToken,
      token_type: value.tokenType ?? "Bearer",
      ...(value.refreshToken ? { refresh_token: value.refreshToken } : {}),
      ...(value.scope ? { scope: value.scope } : {}),
    };
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const result = this.pending.then(async () => {
      await this.assertActive();
      const client = await this.clientInformation();
      const server = this.bundle.server;
      if (!client || server.type === "stdio")
        throw new ConnectorError(
          "authorization",
          "The sign-in registration is no longer available.",
        );
      const next: State = {
        ...this.grant,
        kind: "oauth",
        resourceUrl: server.url,
        client: {
          clientId: client.client_id,
          clientSecret: client.client_secret,
          redirectUri: this.redirectUrl,
        },
        tokens: {
          accessToken: tokens.access_token,
          tokenType: tokens.token_type,
          refreshToken: tokens.refresh_token ?? this.grant.tokens?.refreshToken,
          scope: tokens.scope ?? this.grant.tokens?.scope,
          ...(tokens.expires_in === undefined
            ? {}
            : { expiresAt: this.now() + tokens.expires_in * 1000 }),
        },
        authorizedAt: this.now(),
        refreshBlocked: false,
      };
      const bundle = { ...this.bundle, authorization: next };
      const accepted = await this.options.store.writeBundle(
        this.options.entry,
        this.revision,
        bundle,
        () => this.options.active() && !this.options.signal?.aborted,
      );
      this.bundle = bundle;
      this.grant = next;
      this.revision = accepted;
      return undefined;
    });
    this.pending = result;
    return result;
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    await this.assertActive();
    if (!this.options.interactive || !this.options.onRedirect)
      throw new ConnectorError("authorization", "Sign in again from Settings > Connectors.");
    connectorEndpoint(url.toString());
    for (const [key, value] of Object.entries(this.registration?.authorizationParams ?? {}))
      url.searchParams.set(key, value);
    this.options.onRedirect(url);
  }
  async saveCodeVerifier(value: string): Promise<void> {
    await this.assertActive();
    this.verifier = value;
  }
  async codeVerifier(): Promise<string> {
    await this.assertActive();
    if (!this.verifier)
      throw new ConnectorError(
        "authorization",
        "Start sign-in again; its verification state expired.",
      );
    return this.verifier;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    await this.assertActive();
    if (
      this.registration &&
      (value.authorizationServerUrl !== this.registration.authorizationServerUrl ||
        value.authorizationServerMetadata?.authorization_endpoint !==
          this.registration.authorizationEndpoint ||
        value.authorizationServerMetadata?.token_endpoint !== this.registration.tokenEndpoint)
    )
      throw new ConnectorError(
        "authorization",
        "The vendor's endpoints no longer match Otto's public client registration.",
      );
    this.grant = { ...this.grant, discovery: Discovery.parse(value) };
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.grant.discovery;
  }
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    await this.assertActive();
    if (scope === "verifier") {
      this.verifier = null;
      return;
    }
    const next = { ...this.grant };
    if (scope === "all" || scope === "client") delete next.client;
    if (scope === "all" || scope === "tokens") delete next.tokens;
    if (scope === "all" || scope === "discovery") delete next.discovery;
    if (!this.options.interactive) {
      const bundle = { ...this.bundle, authorization: next };
      this.revision = await this.options.store.writeBundle(
        this.options.entry,
        this.revision,
        bundle,
        () => this.options.active() && !this.options.signal?.aborted,
      );
      this.bundle = bundle;
    }
    this.grant = next;
  }
  async begin(): Promise<"AUTHORIZED" | "REDIRECT"> {
    const server = this.bundle.server;
    if (server.type === "stdio")
      throw new ConnectorError("validation", "Browser sign-in requires a remote connector.");
    return auth(this, {
      serverUrl: server.url,
      scope: this.registration?.scopes.join(" ") || this.bundle.scope || undefined,
      fetchFn: this.fetcher,
    });
  }
  async complete(code: string): Promise<void> {
    await this.assertActive();
    if (this.codeConsumed)
      throw new ConnectorError(
        "authorization",
        "This authorization code was already consumed. Start sign-in again.",
      );
    this.codeConsumed = true;
    const discovery = this.grant.discovery;
    const server = this.bundle.server;
    if (!discovery || server.type === "stdio")
      throw new ConnectorError(
        "authorization",
        "Start sign-in again; its discovery state expired.",
      );
    // Exchange once against the client/discovery that started consent. auth()
    // can reset a rejected client; it must never replay an authorization code.
    try {
      const tokens = await fetchToken(this, discovery.authorizationServerUrl, {
        metadata: discovery.authorizationServerMetadata,
        resource: await selectResourceURL(server.url, this, discovery.resourceMetadata),
        authorizationCode: code,
        fetchFn: this.fetcher,
      });
      await this.saveTokens(tokens);
    } finally {
      this.verifier = null;
    }
  }
  async access(): Promise<{ token: string; revision: string }> {
    if (this.grant.refreshBlocked)
      throw new ConnectorError(
        "authorization",
        "Authorization renewal did not finish. Review the connection in Settings before reconnecting.",
      );
    const value = this.grant.tokens;
    if (!value)
      throw new ConnectorError(
        "authorization",
        "Sign in from Settings > Connectors before using its tools.",
      );
    if (value.expiresAt !== undefined && value.expiresAt <= this.now() + 60000) {
      if (!value.refreshToken)
        throw new ConnectorError(
          "authorization",
          "This connector's sign-in expired. Reconnect it in Settings.",
        );
      const discovery = this.grant.discovery;
      const client = await this.clientInformation();
      const server = this.bundle.server;
      if (!discovery || !client || server.type === "stdio")
        throw new ConnectorError(
          "authorization",
          "The saved sign-in has no renewal metadata. Reconnect it in Settings.",
        );
      // Write ahead of a potentially rotating refresh. If the exchange or its
      // publication is uncertain, a later request must not replay the old token.
      const bundle = { ...this.bundle, authorization: { ...this.grant, refreshBlocked: true } };
      this.revision = await this.options.store.writeBundle(
        this.options.entry,
        this.revision,
        bundle,
        () => this.options.active() && !this.options.signal?.aborted,
      );
      this.bundle = bundle;
      this.grant = State.parse(bundle.authorization);
      // The general SDK auth() helper may invalidate credentials and recover by
      // starting another flow. A rotating refresh is one non-replayable exchange.
      const renewed = await refreshAuthorization(discovery.authorizationServerUrl, {
        metadata: discovery.authorizationServerMetadata,
        clientInformation: client,
        refreshToken: value.refreshToken,
        resource: await selectResourceURL(server.url, this, discovery.resourceMetadata),
        fetchFn: this.fetcher,
      });
      await this.saveTokens(renewed);
    }
    const tokens = await this.tokens();
    if (!tokens || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tokens.token_type))
      throw new ConnectorError(
        "authorization",
        "The vendor returned unsupported authorization data. Reconnect this connector.",
      );
    return { token: `${tokens.token_type} ${tokens.access_token}`, revision: this.revision };
  }
  async disconnect(): Promise<void> {
    await this.assertActive();
    const bundle = disconnectedConnectorBundle(this.bundle);
    this.revision = await this.options.store.writeBundle(
      this.options.entry,
      this.revision,
      bundle,
      () => this.options.active() && !this.options.signal?.aborted,
    );
    this.bundle = bundle;
    this.grant = {};
  }
  status() {
    return {
      connected: Boolean(this.grant.tokens) && !this.grant.refreshBlocked,
      account: this.grant.account ?? null,
      scopes: this.grant.tokens?.scope?.split(/\s+/).filter(Boolean) ?? [],
      message: this.grant.refreshBlocked
        ? "Authorization renewal did not finish. Review the connection before reconnecting."
        : null,
    };
  }
}
