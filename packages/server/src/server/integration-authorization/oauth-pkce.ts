import { createHash, randomBytes } from "node:crypto";

export interface OAuthPkceClientDefinition {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  publicClientId: string;
  scopes: readonly string[];
  /** Provider-specific public parameters required on every authorization request. */
  authorizationParams?: Readonly<Record<string, string>>;
}

export interface OAuthPkcePair {
  verifier: string;
  challenge: string;
}

export interface OAuthPkceTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  grantedScopes: string[];
}

export interface OAuthPkceFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type OAuthPkceFetch = (
  input: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<OAuthPkceFetchResponse>;

/** Deliberately contains no response body: OAuth failures can include sensitive data. */
export class OAuthPkceExchangeError extends Error {
  constructor(readonly status: number) {
    super(`OAuth token exchange failed with status ${status}.`);
    this.name = "OAuthPkceExchangeError";
  }
}

/**
 * Provider-neutral PKCE primitive. The verifier remains only in daemon memory
 * for the pending browser flow; it must never be written to the registry,
 * credential vault, logs, or a WebSocket message.
 */
export function createOAuthPkcePair(): OAuthPkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthPkceAuthorizationUrl(params: {
  client: OAuthPkceClientDefinition;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.client.authorizationEndpoint);
  url.search = new URLSearchParams({
    ...params.client.authorizationParams,
    response_type: "code",
    client_id: params.client.publicClientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    ...(params.client.scopes.length > 0 ? { scope: params.client.scopes.join(" ") } : {}),
  }).toString();
  return url.toString();
}

export async function exchangeOAuthPkceAuthorizationCode(params: {
  client: OAuthPkceClientDefinition;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetch?: OAuthPkceFetch;
  now?: () => Date;
}): Promise<OAuthPkceTokenSet> {
  return requestOAuthPkceToken({
    client: params.client,
    body: {
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    },
    fetch: params.fetch,
    now: params.now,
  });
}

export async function refreshOAuthPkceToken(params: {
  client: OAuthPkceClientDefinition;
  refreshToken: string;
  fetch?: OAuthPkceFetch;
  now?: () => Date;
}): Promise<OAuthPkceTokenSet> {
  return requestOAuthPkceToken({
    client: params.client,
    body: {
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    },
    fetch: params.fetch,
    now: params.now,
    previousRefreshToken: params.refreshToken,
  });
}

async function requestOAuthPkceToken(params: {
  client: OAuthPkceClientDefinition;
  body: Record<string, string>;
  fetch?: OAuthPkceFetch;
  now?: () => Date;
  previousRefreshToken?: string;
}): Promise<OAuthPkceTokenSet> {
  const fetchFn = params.fetch ?? globalThis.fetch;
  const response = await fetchFn(params.client.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...params.body,
      client_id: params.client.publicClientId,
    }).toString(),
  });
  if (!response.ok) {
    throw new OAuthPkceExchangeError(response.status);
  }
  return parseOAuthTokenSet(
    await response.json(),
    params.now ?? (() => new Date()),
    params.previousRefreshToken,
  );
}

export function parseOAuthTokenSet(
  value: unknown,
  now: () => Date,
  previousRefreshToken?: string,
): OAuthPkceTokenSet {
  if (
    !isRecord(value) ||
    typeof value.access_token !== "string" ||
    value.access_token.length === 0
  ) {
    throw new OAuthPkceExchangeError(200);
  }
  const refreshToken =
    typeof value.refresh_token === "string" && value.refresh_token.length > 0
      ? value.refresh_token
      : previousRefreshToken;
  if (!refreshToken) {
    throw new OAuthPkceExchangeError(200);
  }
  if (
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0
  ) {
    throw new OAuthPkceExchangeError(200);
  }
  return {
    accessToken: value.access_token,
    refreshToken,
    expiresAt: new Date(now().getTime() + value.expires_in * 1000).toISOString(),
    grantedScopes: parseScopes(value.scope),
  };
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope.split(/[\s,]+/).filter((value) => value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
