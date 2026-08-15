import { createServer } from "node:http";
import { BrowserAuthorizationAttemptManager } from "../integration-authorization/browser-authorization-attempt.js";
import type { OAuthPkceTokenSet } from "../integration-authorization/oauth-pkce.js";
import {
  createOAuthPkceAuthorizationUrl,
  createOAuthPkcePair,
  exchangeOAuthPkceAuthorizationCode,
  OAuthPkceExchangeError,
} from "../integration-authorization/oauth-pkce.js";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  ZOOM_TEAM_CHAT_CONNECTION_ID,
  ZOOM_TEAM_CHAT_PROVIDER_ID,
} from "./zoom-team-chat-provider.js";
import { createZoomTeamChatOAuthClient } from "./zoom-team-chat-oauth.js";
import { ZoomTeamChatClient } from "./zoom-team-chat-client.js";

/** Must exactly match the development redirect URL registered in Zoom. */
export const ZOOM_TEAM_CHAT_OAUTH_CALLBACK_PATH = "/integrations/zoom-team-chat/oauth/callback";
export const ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI =
  "http://127.0.0.1:6872/integrations/zoom-team-chat/oauth/callback";
const ZOOM_TEAM_CHAT_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1000;

function zoomTeamChatAuthorizationAttemptKey(): string {
  return `${ZOOM_TEAM_CHAT_PROVIDER_ID}:${ZOOM_TEAM_CHAT_CONNECTION_ID}`;
}

export interface ZoomTeamChatAuthorizationStartResult {
  authorizationUrl: string;
}
export type ZoomTeamChatAuthorizationCallbackResult =
  | { status: "connected" }
  | {
      status: "failed";
      errorCode:
        | "cancelled"
        | "state_mismatch"
        | "missing_code"
        | "exchange_failed"
        | "token_storage_failed"
        | `exchange_failed_${number}`;
    };

interface PendingAuthorization {
  state: string;
  verifier: string;
  challenge: string;
}

interface LoopbackCallbackServer {
  close(): void | Promise<void>;
}

type OpenLoopbackCallbackServer = (
  handleCallback: (params: {
    state: string | null;
    code: string | null;
    error: string | null;
  }) => Promise<ZoomTeamChatAuthorizationCallbackResult>,
) => Promise<LoopbackCallbackServer>;

type ResolveZoomTeamChatAccountLabel = (accessToken: string) => Promise<string | null>;

async function resolveZoomTeamChatAccountLabel(accessToken: string): Promise<string | null> {
  const user = await new ZoomTeamChatClient(async () => accessToken).getCurrentUser();
  return user.email ?? user.displayName;
}

function openZoomTeamChatLoopbackCallbackServer(
  handleCallback: Parameters<OpenLoopbackCallbackServer>[0],
): Promise<LoopbackCallbackServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI);
      if (request.method !== "GET" || requestUrl.pathname !== ZOOM_TEAM_CHAT_OAUTH_CALLBACK_PATH) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
      }

      void handleCallback({
        state: requestUrl.searchParams.get("state"),
        code: requestUrl.searchParams.get("code"),
        error: requestUrl.searchParams.get("error"),
      })
        .then((result) => {
          response.writeHead(result.status === "connected" ? 200 : 400, {
            "content-type": "text/html; charset=utf-8",
          });
          return response.end(
            result.status === "connected"
              ? "Zoom Team Chat is connected. You can close this tab."
              : "Zoom Team Chat sign-in did not complete. You can close this tab and try again.",
          );
        })
        .catch(() => {
          response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
          return response.end(
            "Zoom Team Chat sign-in failed. You can close this tab and try again.",
          );
        });
    });
    server.once("error", reject);
    server.listen(6872, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        close: () =>
          new Promise<void>((close) => {
            server.close(() => close());
          }),
      });
    });
  });
}

/**
 * Zoom's Otto-managed PKCE flow. The pending verifier is daemon memory only;
 * neither it, the authorization code, nor either token can cross the session
 * protocol. The fixed loopback callback means sign-in requires the daemon and
 * browser on the same machine.
 */
export class ZoomTeamChatManagedAuthorizationBroker {
  readonly integrationId = ZOOM_TEAM_CHAT_PROVIDER_ID;
  readonly connectionId = ZOOM_TEAM_CHAT_CONNECTION_ID;
  private readonly attempts = new BrowserAuthorizationAttemptManager<PendingAuthorization>();
  private readonly client = createZoomTeamChatOAuthClient();

  constructor(
    private readonly authorization: IntegrationAuthorizationService,
    private readonly exchangeAuthorizationCode: (params: {
      client: ReturnType<typeof createZoomTeamChatOAuthClient>;
      code: string;
      redirectUri: string;
      codeVerifier: string;
    }) => Promise<OAuthPkceTokenSet> = exchangeOAuthPkceAuthorizationCode,
    private readonly openLoopbackCallbackServer: OpenLoopbackCallbackServer = openZoomTeamChatLoopbackCallbackServer,
    private readonly resolveAccountLabel: ResolveZoomTeamChatAccountLabel = resolveZoomTeamChatAccountLabel,
  ) {}

  async start(): Promise<ZoomTeamChatAuthorizationStartResult> {
    const vault = await this.authorization.getVaultAvailability();
    if (vault.status !== "available") {
      throw new ZoomTeamChatAuthorizationUnavailableError(vault.reason);
    }
    let started: { value: PendingAuthorization };
    try {
      started = await this.attempts.replace({
        key: zoomTeamChatAuthorizationAttemptKey(),
        timeoutMs: ZOOM_TEAM_CHAT_AUTHORIZATION_TIMEOUT_MS,
        start: async (attempt) => {
          const pair = createOAuthPkcePair();
          const callbackServer = await this.openLoopbackCallbackServer((params) =>
            this.handleCallback(attempt.id, params),
          );
          return {
            value: { state: attempt.id, verifier: pair.verifier, challenge: pair.challenge },
            cancel: () => callbackServer.close(),
          };
        },
        onTimeout: async (attempt) => {
          await this.recordFailure("cancelled", attempt.id);
        },
      });
    } catch {
      throw new ZoomTeamChatAuthorizationUnavailableError(
        "The local sign-in callback at 127.0.0.1:6872 could not be opened.",
      );
    }

    try {
      await this.authorization.selectConnectionMethod({
        integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
        method: "oauth-pkce",
      });
      await this.authorization.saveConnectionMetadata({
        integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
        method: "oauth-pkce",
        state: "authorizing",
      });
    } catch {
      await this.attempts.cancel(zoomTeamChatAuthorizationAttemptKey());
      throw new ZoomTeamChatAuthorizationUnavailableError(
        "Otto could not prepare secure storage for Zoom Team Chat sign-in.",
      );
    }
    return {
      authorizationUrl: createOAuthPkceAuthorizationUrl({
        client: this.client,
        redirectUri: ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI,
        state: started.value.state,
        codeChallenge: started.value.challenge,
      }),
    };
  }

  async handleCallback(
    attemptId: string,
    params: {
      state: string | null;
      code: string | null;
      error: string | null;
    },
  ): Promise<ZoomTeamChatAuthorizationCallbackResult> {
    const pending = this.attempts.get(zoomTeamChatAuthorizationAttemptKey(), attemptId);
    if (!pending || params.state !== pending.value.state) {
      // A browser tab from a replaced attempt can still finish loading. It
      // must not cancel the newer attempt that owns the current verifier.
      return { status: "failed", errorCode: "state_mismatch" };
    }
    if (params.error) {
      return this.fail(attemptId, "cancelled");
    }
    if (!params.code) {
      return this.fail(attemptId, "missing_code");
    }

    const claimed = this.attempts.take(zoomTeamChatAuthorizationAttemptKey(), attemptId);
    if (!claimed) return { status: "failed", errorCode: "state_mismatch" };
    // This handler is serving the callback request. Node resolves the listener
    // close promise after that response ends, so it must not be awaited here.
    void Promise.resolve(claimed.cancel()).catch(() => undefined);
    let tokens: OAuthPkceTokenSet;
    try {
      tokens = await this.exchangeAuthorizationCode({
        client: this.client,
        code: params.code,
        redirectUri: ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI,
        codeVerifier: claimed.value.verifier,
      });
    } catch (error) {
      return this.recordFailure(
        error instanceof OAuthPkceExchangeError
          ? `exchange_failed_${error.status}`
          : "exchange_failed",
        attemptId,
      );
    }

    try {
      const accountLabel = tokens.grantedScopes.includes("user:read:user")
        ? await this.resolveAccountLabel(tokens.accessToken).catch(() => null)
        : null;
      await this.authorization.saveOAuthTokenSet({
        integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
        method: "oauth-pkce",
        tokens,
        accountLabel,
      });
      return { status: "connected" };
    } catch {
      return this.recordFailure("token_storage_failed", attemptId);
    }
  }

  private async fail(
    attemptId: string,
    errorCode: Extract<ZoomTeamChatAuthorizationCallbackResult, { status: "failed" }>["errorCode"],
  ): Promise<ZoomTeamChatAuthorizationCallbackResult> {
    const claimed = this.attempts.take(zoomTeamChatAuthorizationAttemptKey(), attemptId);
    // See the callback note above: failures from a live callback must release
    // the listener without waiting for their own HTTP response to finish.
    if (claimed) void Promise.resolve(claimed.cancel()).catch(() => undefined);
    return this.recordFailure(errorCode, attemptId);
  }

  private async recordFailure(
    errorCode: Extract<ZoomTeamChatAuthorizationCallbackResult, { status: "failed" }>["errorCode"],
    attemptId?: string,
  ): Promise<ZoomTeamChatAuthorizationCallbackResult> {
    if (attemptId && !this.attempts.isLatest(zoomTeamChatAuthorizationAttemptKey(), attemptId)) {
      return { status: "failed", errorCode };
    }
    await this.authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "error",
      errorCode,
    });
    return { status: "failed", errorCode };
  }
}

export { ZOOM_TEAM_CHAT_OAUTH_SCOPES } from "./zoom-team-chat-oauth.js";

export class ZoomTeamChatAuthorizationUnavailableError extends Error {
  constructor(reason: string) {
    super(`Zoom Team Chat sign-in is unavailable: ${reason}`);
    this.name = "ZoomTeamChatAuthorizationUnavailableError";
  }
}
