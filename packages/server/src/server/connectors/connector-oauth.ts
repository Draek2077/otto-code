// OAuth 2.1 for connectors whose MCP server authenticates by login rather than
// by a pasted token. This is what makes a connector "already configured": the
// user clicks Connect, logs in on the vendor's own page, and Otto holds the
// tokens from then on.
//
// The SDK owns the protocol (RFC 9728 discovery, dynamic client registration,
// PKCE, code exchange, refresh). What it does NOT own, and what lives here, is
// the three application-defined pieces it calls back into:
//   1. storage    - where tokens and the client registration are persisted
//   2. redirect   - how the user's browser is sent to the authorization page
//   3. the return - catching the redirect back and resuming the exchange
//
// The redirect lands on a loopback HTTP listener the daemon starts for the
// duration of one flow (RFC 8252 native-app pattern). We do not route it through
// the daemon's own HTTP server: that server is not always bound to loopback
// (WSL auto-bind), and an authorization code arriving on a LAN-reachable
// interface is a code someone else can race us for.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import type { Logger } from "pino";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { ConnectorAuthState, ConnectorConfig } from "@otto-code/protocol/provider-config";

/** How long an unfinished login holds its loopback port before giving up. */
const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Refresh this far before the access token's stated expiry. Clock skew between
 * daemon and authorization server is real, and a token that expires mid-request
 * surfaces as a confusing tool failure rather than a re-login prompt.
 */
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Preferred loopback port. A stable redirect URI lets a second login reuse the
 * first login's client registration; when the port is taken we fall back to an
 * ephemeral one and re-register, which is correct but slower.
 */
const PREFERRED_CALLBACK_PORT = 6871;

const CALLBACK_PATH = "/connectors/oauth/callback";

/** Persistence seam. Backed by DaemonConfigStore in the daemon, memory in tests. */
export interface ConnectorAuthStore {
  read(connectorId: string): ConnectorAuthState | undefined;
  write(connectorId: string, auth: ConnectorAuthState | null): void;
}

export interface ConnectorOAuthBrokerOptions {
  store: ConnectorAuthStore;
  logger?: Logger;
  /** Injected in tests to avoid binding a real socket. */
  now?: () => number;
}

export interface BeginAuthorizationParams {
  connector: ConnectorConfig;
  /** OAuth scopes to request, when the catalog entry names them. */
  scope?: string;
}

export type BeginAuthorizationResult =
  | { status: "authorized" }
  | { status: "redirect"; authorizationUrl: string };

interface PendingFlow {
  connectorId: string;
  state: string;
  provider: ConnectorOAuthProvider;
  server: Server;
  serverUrl: string;
  timer: NodeJS.Timeout;
  settle(result: { ok: true } | { ok: false; error: string }): void;
}

function isExpired(state: ConnectorAuthState | undefined, now: number): boolean {
  const expiresAt = state?.tokens?.expiresAt;
  return typeof expiresAt === "number" && expiresAt - EXPIRY_SKEW_MS <= now;
}

/**
 * True when this connector can be reached without sending the user to a login
 * page: it holds an access token that has not lapsed, or a refresh token the SDK
 * can silently exchange.
 */
export function hasUsableAuthorization(
  connector: ConnectorConfig,
  now: number = Date.now(),
): boolean {
  const state = connector.auth;
  if (!state?.tokens) {
    return false;
  }
  return state.tokens.refreshToken !== undefined || !isExpired(state, now);
}

/**
 * The SDK's storage + redirect callbacks, bound to one connector.
 *
 * Two modes. Interactive (`onRedirect` set) is a live login: it captures the
 * authorization URL so the broker can hand it to the UI. Non-interactive
 * (`onRedirect` absent) is what the agent path uses at connect time - it can
 * refresh an expired token silently, but if the server demands a full
 * re-login it throws rather than opening a browser nobody asked for.
 */
class ConnectorOAuthProvider implements OAuthClientProvider {
  private readonly connectorId: string;
  private readonly store: ConnectorAuthStore;
  private readonly redirectUri: string;
  private readonly onRedirect: ((url: URL) => void) | undefined;
  private readonly stateValue: string;
  private readonly now: () => number;
  // PKCE verifier is per-flow and never persisted: it is only meaningful
  // between the authorization request and the code exchange minutes later.
  private verifier: string | undefined;

  constructor(params: {
    connectorId: string;
    store: ConnectorAuthStore;
    redirectUri: string;
    state: string;
    now: () => number;
    onRedirect?: (url: URL) => void;
  }) {
    this.connectorId = params.connectorId;
    this.store = params.store;
    this.redirectUri = params.redirectUri;
    this.stateValue = params.state;
    this.now = params.now;
    this.onRedirect = params.onRedirect;
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Otto",
      client_uri: "https://otto-code.me",
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Public client: the daemon runs on the user's machine, so there is no
      // secret it could keep. PKCE is what protects the exchange.
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const stored = this.store.read(this.connectorId)?.client;
    // A registration made against a different redirect URI cannot be reused:
    // the authorization server will reject the mismatch at the authorize step.
    if (!stored || stored.redirectUri !== this.redirectUri) {
      return undefined;
    }
    return {
      client_id: stored.clientId,
      ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}),
    };
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    const current = this.store.read(this.connectorId);
    this.store.write(this.connectorId, {
      kind: "oauth",
      ...current,
      client: {
        clientId: clientInformation.client_id,
        ...(clientInformation.client_secret
          ? { clientSecret: clientInformation.client_secret }
          : {}),
        redirectUri: this.redirectUri,
      },
    });
  }

  tokens(): OAuthTokens | undefined {
    const stored = this.store.read(this.connectorId)?.tokens;
    if (!stored) {
      return undefined;
    }
    return {
      access_token: stored.accessToken,
      token_type: stored.tokenType ?? "Bearer",
      ...(stored.refreshToken ? { refresh_token: stored.refreshToken } : {}),
      ...(stored.scope ? { scope: stored.scope } : {}),
    };
  }

  saveTokens(tokens: OAuthTokens): void {
    const current = this.store.read(this.connectorId);
    // A refresh token is often omitted on refresh responses; keeping the
    // previous one is the difference between staying logged in and being
    // silently logged out on the next expiry.
    const refreshToken = tokens.refresh_token ?? current?.tokens?.refreshToken;
    this.store.write(this.connectorId, {
      kind: "oauth",
      ...current,
      tokens: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type,
        ...(refreshToken ? { refreshToken } : {}),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        ...(tokens.expires_in !== undefined
          ? { expiresAt: this.now() + tokens.expires_in * 1000 }
          : {}),
      },
      authorizedAt: this.now(),
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.onRedirect) {
      throw new Error(
        "This connector needs you to sign in again. Open Settings > Connectors and choose Reconnect.",
      );
    }
    this.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error("Authorization is no longer in progress; start the connection again.");
    }
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "verifier") {
      this.verifier = undefined;
      return;
    }
    if (scope === "discovery") {
      return;
    }
    const current = this.store.read(this.connectorId);
    if (!current) {
      return;
    }
    if (scope === "all") {
      this.store.write(this.connectorId, null);
      return;
    }
    const { tokens, client, ...rest } = current;
    this.store.write(this.connectorId, {
      ...rest,
      kind: "oauth",
      ...(scope === "tokens" ? { client } : { tokens }),
    });
  }
}

/**
 * Builds the non-interactive provider the MCP client uses at connect time, so an
 * expired access token is refreshed transparently. Returns undefined when the
 * connector holds no authorization, which keeps unauthenticated servers on the
 * plain no-auth path.
 */
export function createConnectorAuthProvider(params: {
  connector: ConnectorConfig;
  store: ConnectorAuthStore;
  now?: () => number;
}): OAuthClientProvider | undefined {
  const state = params.connector.auth;
  if (!state?.tokens) {
    return undefined;
  }
  return new ConnectorOAuthProvider({
    connectorId: params.connector.id,
    store: params.store,
    // Refresh never redirects, but the SDK still sends redirect_uri on the
    // token request, so it has to match what the client registered with.
    redirectUri: state.client?.redirectUri ?? loopbackRedirectUri(PREFERRED_CALLBACK_PORT),
    state: "",
    now: params.now ?? Date.now,
  });
}

function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

function renderCallbackPage(title: string, detail: string): string {
  // Deliberately dependency-free and inert: this HTML is rendered by whatever
  // browser the user logged in with, which is outside our trust boundary.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#111;color:#eee;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{text-align:center;max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#aaa;margin:0;line-height:1.5}</style></head>
<body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

export class ConnectorOAuthBroker {
  private readonly store: ConnectorAuthStore;
  private readonly logger: Logger | undefined;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly completions = new Map<string, Promise<void>>();

  constructor(options: ConnectorOAuthBrokerOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  /**
   * Start a login. Resolves as soon as there is an authorization URL for the UI
   * to open (or immediately, when the stored tokens already suffice). The user
   * finishing the login is a separate event: await waitForCompletion.
   */
  async beginAuthorization(params: BeginAuthorizationParams): Promise<BeginAuthorizationResult> {
    const { connector } = params;
    if (connector.server.type === "stdio") {
      throw new Error("OAuth applies to remote connectors; this one runs a local command.");
    }
    // A second Connect on the same connector supersedes the first: leaving the
    // old listener bound would strand a port and accept a stale code.
    this.cancel(connector.id, "Superseded by a new connection attempt.");

    const state = randomUUID();
    const { server, port } = await this.listen();
    const redirectUri = loopbackRedirectUri(port);
    let capturedUrl: URL | undefined;
    const provider = new ConnectorOAuthProvider({
      connectorId: connector.id,
      store: this.store,
      redirectUri,
      state,
      now: this.now,
      onRedirect: (url) => {
        capturedUrl = url;
      },
    });

    const serverUrl = connector.server.url;
    let settled = false;
    const completion = new Promise<void>((resolve, reject) => {
      const flow: PendingFlow = {
        connectorId: connector.id,
        state,
        provider,
        server,
        serverUrl,
        timer: setTimeout(() => {
          this.finish(connector.id, {
            ok: false,
            error: "Timed out waiting for the sign-in to finish.",
          });
        }, AUTHORIZATION_TIMEOUT_MS),
        settle: (result) => {
          if (settled) {
            return;
          }
          settled = true;
          if (result.ok) {
            resolve();
          } else {
            reject(new Error(result.error));
          }
        },
      };
      this.pending.set(connector.id, flow);
    });
    // Nothing awaits this until waitForCompletion is called; without a sink an
    // early failure would surface as an unhandled rejection and take the daemon
    // down.
    completion.catch(() => undefined);
    this.completions.set(connector.id, completion);

    server.on("request", (req, res) => {
      void this.handleCallback(connector.id, req.url ?? "", res);
    });

    try {
      const result = await auth(provider, {
        serverUrl,
        ...(params.scope ? { scope: params.scope } : {}),
      });
      if (result === "AUTHORIZED") {
        this.finish(connector.id, { ok: true });
        return { status: "authorized" };
      }
    } catch (error) {
      this.finish(connector.id, { ok: false, error: describeError(error) });
      throw error;
    }

    if (!capturedUrl) {
      this.finish(connector.id, {
        ok: false,
        error: "The connector's authorization server did not return a sign-in URL.",
      });
      throw new Error("The connector's authorization server did not return a sign-in URL.");
    }
    return { status: "redirect", authorizationUrl: capturedUrl.toString() };
  }

  /** Resolves when the user finishes the login; rejects on denial or timeout. */
  waitForCompletion(connectorId: string): Promise<void> {
    return this.completions.get(connectorId) ?? Promise.resolve();
  }

  /** Drop a connector's authorization entirely (the Disconnect button). */
  disconnect(connectorId: string): void {
    this.cancel(connectorId, "Disconnected.");
    this.store.write(connectorId, null);
  }

  cancel(connectorId: string, reason: string): void {
    this.finish(connectorId, { ok: false, error: reason });
  }

  /** Close every listener. Called on daemon shutdown. */
  closeAll(): void {
    // Snapshot the keys first: cancel() deletes from the map it iterates.
    const connectorIds = Array.from(this.pending.keys());
    for (const connectorId of connectorIds) {
      this.cancel(connectorId, "The daemon is shutting down.");
    }
  }

  private async handleCallback(
    connectorId: string,
    rawUrl: string,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    const flow = this.pending.get(connectorId);
    if (!flow) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(rawUrl, "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      const description = url.searchParams.get("error_description") ?? error;
      this.respond(res, 400, "Sign-in failed", description);
      this.finish(connectorId, { ok: false, error: description });
      return;
    }
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    // CSRF: a code arriving with the wrong state is not ours to exchange.
    if (returnedState !== flow.state) {
      this.respond(res, 400, "Sign-in failed", "The sign-in response did not match this request.");
      this.finish(connectorId, { ok: false, error: "Authorization state mismatch." });
      return;
    }
    if (!code) {
      this.respond(res, 400, "Sign-in failed", "No authorization code was returned.");
      this.finish(connectorId, { ok: false, error: "No authorization code was returned." });
      return;
    }
    try {
      const result = await auth(flow.provider, {
        serverUrl: flow.serverUrl,
        authorizationCode: code,
      });
      if (result !== "AUTHORIZED") {
        throw new Error("The authorization server did not issue a token.");
      }
      this.respond(res, 200, "Connected", "You can close this tab and return to Otto.");
      this.finish(connectorId, { ok: true });
    } catch (err) {
      const message = describeError(err);
      this.respond(res, 500, "Sign-in failed", message);
      this.finish(connectorId, { ok: false, error: message });
    }
  }

  private respond(
    res: import("node:http").ServerResponse,
    status: number,
    title: string,
    detail: string,
  ): void {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(renderCallbackPage(title, detail));
  }

  private finish(connectorId: string, result: { ok: true } | { ok: false; error: string }): void {
    const flow = this.pending.get(connectorId);
    if (!flow) {
      return;
    }
    this.pending.delete(connectorId);
    clearTimeout(flow.timer);
    flow.server.close();
    flow.settle(result);
    if (!result.ok) {
      this.logger?.debug({ connectorId, reason: result.error }, "Connector authorization ended");
    }
  }

  private async listen(): Promise<{ server: Server; port: number }> {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === "EADDRINUSE") {
          // Fall back to an ephemeral port. Costs a re-registration, beats
          // failing the login because something else holds the preferred port.
          server.listen(0, "127.0.0.1");
          return;
        }
        reject(err);
      };
      server.on("error", onError);
      server.on("listening", () => {
        server.removeListener("error", onError);
        const address = server.address() as AddressInfo | null;
        if (!address) {
          reject(new Error("Failed to bind the sign-in callback listener."));
          return;
        }
        resolve(address.port);
      });
      server.listen(PREFERRED_CALLBACK_PORT, "127.0.0.1");
    });
    return { server, port };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
