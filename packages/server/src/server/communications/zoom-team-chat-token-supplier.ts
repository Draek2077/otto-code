import {
  IntegrationAuthorizationSecretError,
  IntegrationAuthorizationService,
  type IntegrationOAuthTokenSet,
} from "../integration-authorization/integration-authorization-service.js";
import {
  refreshOAuthPkceToken,
  type OAuthPkceTokenSet,
} from "../integration-authorization/oauth-pkce.js";
import { createZoomTeamChatOAuthClient } from "./zoom-team-chat-oauth.js";
import {
  ZOOM_TEAM_CHAT_CONNECTION_ID,
  ZOOM_TEAM_CHAT_PROVIDER_ID,
} from "./zoom-team-chat-provider.js";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
type RefreshZoomTeamChatToken = (params: {
  client: ReturnType<typeof createZoomTeamChatOAuthClient>;
  refreshToken: string;
  now: () => Date;
}) => Promise<OAuthPkceTokenSet>;

export class ZoomTeamChatReauthenticationRequiredError extends Error {
  constructor() {
    super("Zoom Team Chat needs to be reconnected before it can make requests.");
    this.name = "ZoomTeamChatReauthenticationRequiredError";
  }
}

/**
 * The only Zoom REST token source. It reads the daemon vault just in time,
 * refreshes an expiring token through Otto's public PKCE client, and persists
 * the replacement only in the daemon vault.
 */
export function createZoomTeamChatAccessTokenSupplier(
  authorization: IntegrationAuthorizationService,
  now: () => Date = () => new Date(),
  refresh: RefreshZoomTeamChatToken = refreshOAuthPkceToken,
): () => Promise<string> {
  let refreshInFlight: Promise<string> | null = null;
  return async () => {
    try {
      const tokens = await authorization.readOAuthTokenSet({
        integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      });
      if (
        !tokens ||
        Date.parse(tokens.expiresAt) - now().getTime() <= ACCESS_TOKEN_REFRESH_SKEW_MS
      ) {
        if (!tokens) {
          throw new ZoomTeamChatReauthenticationRequiredError();
        }
        if (!refreshInFlight) {
          refreshInFlight = refreshZoomTeamChatToken({ authorization, tokens, now, refresh });
        }
        try {
          return await refreshInFlight;
        } finally {
          refreshInFlight = null;
        }
      }
      return tokens.accessToken;
    } catch (error) {
      if (
        error instanceof ZoomTeamChatReauthenticationRequiredError ||
        error instanceof IntegrationAuthorizationSecretError
      ) {
        throw error;
      }
      throw new ZoomTeamChatReauthenticationRequiredError();
    }
  };
}

async function refreshZoomTeamChatToken(params: {
  authorization: IntegrationAuthorizationService;
  tokens: IntegrationOAuthTokenSet;
  now: () => Date;
  refresh: RefreshZoomTeamChatToken;
}): Promise<string> {
  const { authorization, tokens, now, refresh } = params;
  try {
    const refreshed = await refresh({
      client: createZoomTeamChatOAuthClient(),
      refreshToken: tokens.refreshToken,
      now,
    });
    const connection = await authorization.getConnection({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
    });
    await authorization.saveOAuthTokenSet({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      tokens: {
        ...refreshed,
        grantedScopes:
          refreshed.grantedScopes.length > 0 ? refreshed.grantedScopes : tokens.grantedScopes,
      },
      accountLabel: connection?.accountLabel,
    });
    return refreshed.accessToken;
  } catch {
    const connection = await authorization.getConnection({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
    });
    await authorization
      .saveConnectionMetadata({
        integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
        method: connection?.method ?? "oauth-pkce",
        state: "reauth_required",
        accountLabel: connection?.accountLabel,
        grantedScopes: tokens.grantedScopes,
        errorCode: "token_refresh_failed",
      })
      .catch(() => undefined);
    throw new ZoomTeamChatReauthenticationRequiredError();
  }
}
