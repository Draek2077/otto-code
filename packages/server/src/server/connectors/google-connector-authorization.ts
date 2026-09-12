import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  googleConnectorForConfig,
  type ConnectorConfig,
  type GoogleConnectorService,
} from "@otto-code/protocol/provider-config";
import type { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import { BrowserAuthorizationAttemptManager } from "../integration-authorization/browser-authorization-attempt.js";
import { GOOGLE_CONNECTOR_IDENTITY_SCOPES } from "./google-connector-scopes.js";
import {
  createOAuthPkcePair,
  createOAuthPkceAuthorizationUrl,
  parseOAuthTokenSet,
} from "../integration-authorization/oauth-pkce.js";

export const GOOGLE_CONNECTOR_INTEGRATION_ID = "google-connectors";
const ClientRegistration = z.object({
  installed: z.object({
    client_id: z.string().endsWith(".apps.googleusercontent.com"),
    client_secret: z.string().min(1),
  }),
});
export type GoogleOAuthRegistration = z.infer<typeof ClientRegistration>["installed"];

/** Publisher-supplied desktop registration, copied into the daemon package at build time.
 * This file never contains end-user tokens and is never exposed over a client RPC. */
export async function loadGoogleOAuthRegistration(): Promise<GoogleOAuthRegistration | null> {
  try {
    const asset = import.meta.url.endsWith(".ts")
      ? "../../../dist/server/server/connectors/google-oauth-client.json"
      : "./google-oauth-client.json";
    const file = process.env.OTTO_GOOGLE_OAUTH_CLIENT_FILE ?? new URL(asset, import.meta.url);
    return ClientRegistration.parse(JSON.parse(await readFile(file, "utf8"))).installed;
  } catch {
    return null;
  }
}

export interface GoogleConnectorAuthorizationOptions {
  authorization: IntegrationAuthorizationService;
  registration: GoogleOAuthRegistration | null;
  readConnectors(): readonly ConnectorConfig[];
  fetch?: typeof globalThis.fetch;
}

interface PendingGoogleAuthorization {
  authorizationUrl: string;
}

/** Owns Google protocol only; the common integration platform owns vault and status.
 * Per-connection serialization prevents late callbacks/refreshes resurrecting a disconnect. */
export class GoogleConnectorAuthorization {
  private readonly attempts = new BrowserAuthorizationAttemptManager<PendingGoogleAuthorization>();
  private readonly generations = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly fetch: typeof globalThis.fetch;
  private closed = false;

  constructor(private readonly options: GoogleConnectorAuthorizationOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  get configured(): boolean {
    return this.options.registration !== null;
  }

  private key(connectionId: string) {
    return { integrationId: GOOGLE_CONNECTOR_INTEGRATION_ID, connectionId };
  }

  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
    this.queues.set(id, next);
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      })
      .catch(() => undefined);
    return next;
  }

  private service(id: string): GoogleConnectorService {
    if (this.closed) throw new Error("This host is shutting down.");
    const connector = this.options.readConnectors().find((entry) => entry.id === id);
    const service = connector && googleConnectorForConfig(connector);
    if (!service) throw new Error("This Google connector is no longer installed.");
    return service;
  }

  async start(connectionId: string): Promise<{ authorizationUrl: string }> {
    return this.serial(connectionId, async () => {
      const service = this.service(connectionId);
      const registration = this.options.registration;
      if (!registration)
        throw new Error("Google sign-in is unavailable in this host build. Update the host.");
      const availability = await this.options.authorization.getVaultAvailability();
      if (availability.status !== "available") throw new Error(availability.reason);
      const generation = randomUUID();
      this.generations.set(connectionId, generation);
      const scopes = [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES];
      const { value } = await this.attempts.replace({
        key: connectionId,
        timeoutMs: 600_000,
        onTimeout: () => this.setFailure(connectionId, generation, "authorization_timeout"),
        start: async (attempt) => {
          const pair = createOAuthPkcePair();
          const state = randomUUID();
          let redirectUri = "";
          const server = createServer((req, res) => {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (
              req.method !== "GET" ||
              url.pathname !== "/integrations/google/callback" ||
              url.searchParams.get("state") !== state
            ) {
              reply(res, 400, "Invalid sign-in callback.");
              return;
            }
            const active = this.attempts.take(connectionId, attempt.id);
            if (!active) {
              reply(res, 400, "This sign-in attempt has expired.");
              return;
            }
            void this.complete({
              connectionId,
              generation,
              code: url.searchParams.get("code"),
              redirectUri,
              verifier: pair.verifier,
              scopes,
              res,
            })
              .finally(() => active.cancel())
              .catch(() => {
                // Callback failures must not escape the HTTP server or reveal token responses.
                if (!res.writableEnded)
                  reply(res, 500, "Sign-in could not be saved. Return to Otto and try again.");
              });
          });
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          });
          const address = server.address();
          if (!address || typeof address === "string") {
            server.close();
            throw new Error("Could not open Google sign-in callback.");
          }
          redirectUri = `http://127.0.0.1:${address.port}/integrations/google/callback`;
          const authorizationUrl = createOAuthPkceAuthorizationUrl({
            client: {
              authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
              tokenEndpoint: "https://oauth2.googleapis.com/token",
              publicClientId: registration.client_id,
              scopes,
              authorizationParams: { access_type: "offline", prompt: "consent" },
            },
            redirectUri,
            state,
            codeChallenge: pair.challenge,
          });
          return {
            value: { authorizationUrl },
            cancel: () => {
              server.close();
              server.closeAllConnections();
            },
          };
        },
      });
      try {
        await this.options.authorization.saveConnectionMetadata({
          ...this.key(connectionId),
          method: "oauth-pkce",
          state: "authorizing",
        });
      } catch (error) {
        await this.attempts.cancel(connectionId);
        throw error;
      }
      return value;
    });
  }

  private async complete(params: {
    connectionId: string;
    generation: string;
    code: string | null;
    redirectUri: string;
    verifier: string;
    scopes: string[];
    res: ServerResponse;
  }): Promise<void> {
    try {
      if (!params.code) throw new Error("Authorization was not approved.");
      const tokens = await this.exchange({
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.verifier,
        redirect_uri: params.redirectUri,
      });
      if (!params.scopes.every((scope) => tokens.grantedScopes.includes(scope)))
        throw new Error("Approve the requested Google permissions to connect.");
      const profileResponse = await this.fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      if (!profileResponse.ok) throw new Error("Could not verify the signed-in Google account.");
      const profile = z
        .object({ email: z.string().email(), verified_email: z.literal(true) })
        .parse(await profileResponse.json());
      await this.serial(params.connectionId, async () => {
        this.service(params.connectionId);
        if (this.generations.get(params.connectionId) !== params.generation)
          throw new Error("Sign-in was replaced or disconnected.");
        await this.options.authorization.saveOAuthTokenSet({
          ...this.key(params.connectionId),
          method: "oauth-pkce",
          tokens,
          accountLabel: profile.email,
        });
      });
      reply(params.res, 200, "Google connected. You can return to Otto.");
    } catch {
      await this.setFailure(params.connectionId, params.generation, "google_authorization_failed");
      reply(params.res, 400, "Google sign-in did not complete. Return to Otto and try again.");
    }
  }

  private async exchange(body: Record<string, string>, previousRefreshToken?: string) {
    const registration = this.options.registration;
    if (!registration) throw new Error("Google sign-in is unavailable in this host build.");
    const response = await this.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...body,
        client_id: registration.client_id,
        client_secret: registration.client_secret,
      }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Google authorization expired. Reconnect this account.");
    return parseOAuthTokenSet(await response.json(), () => new Date(), previousRefreshToken);
  }

  private async setFailure(id: string, generation: string, errorCode: string): Promise<void> {
    await this.serial(id, async () => {
      if (this.generations.get(id) !== generation || this.closed) return;
      if (
        !this.options
          .readConnectors()
          .some((connector) => connector.id === id && googleConnectorForConfig(connector))
      )
        return;
      await this.options.authorization.saveConnectionMetadata({
        ...this.key(id),
        method: "oauth-pkce",
        state: "error",
        errorCode,
      });
    });
  }

  async accessToken(connectionId: string): Promise<string> {
    const generation = this.generations.get(connectionId);
    return this.serial(connectionId, async () => {
      const service = this.service(connectionId);
      const metadata = await this.options.authorization.getConnection(this.key(connectionId));
      let tokens = await this.options.authorization.readOAuthTokenSet(this.key(connectionId));
      if (
        metadata?.state !== "connected" ||
        !tokens ||
        !service.scopes.every((scope) => tokens?.grantedScopes.includes(scope))
      )
        throw new Error("Connect this Google account in Settings to use its tools.");
      if (Date.parse(tokens.expiresAt) < Date.now() + 60_000) {
        try {
          const refreshed = await this.exchange(
            { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
            tokens.refreshToken,
          );
          if (this.generations.get(connectionId) !== generation)
            throw new Error("This connection was disconnected or replaced.");
          tokens = {
            ...refreshed,
            grantedScopes: refreshed.grantedScopes.length
              ? refreshed.grantedScopes
              : tokens.grantedScopes,
          };
          if (!service.scopes.every((scope) => tokens?.grantedScopes.includes(scope)))
            throw new Error("Google permissions changed.");
          await this.options.authorization.saveOAuthTokenSet({
            ...this.key(connectionId),
            method: "oauth-pkce",
            tokens,
            accountLabel: metadata.accountLabel,
          });
        } catch {
          await this.options.authorization.saveConnectionMetadata({
            ...this.key(connectionId),
            method: "oauth-pkce",
            state: "reauth_required",
            accountLabel: metadata.accountLabel,
          });
          throw new Error("Google authorization expired. Reconnect this account in Settings.");
        }
      }
      if (this.generations.get(connectionId) !== generation || this.closed)
        throw new Error("This connection was disconnected or replaced.");
      this.service(connectionId);
      return tokens.accessToken;
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    this.generations.set(connectionId, randomUUID());
    await this.attempts.cancel(connectionId);
    await this.serial(connectionId, async () => {
      this.generations.set(connectionId, randomUUID());
      await this.attempts.cancel(connectionId);
      await this.options.authorization.deleteConnection(this.key(connectionId));
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.generations.keys()].map((id) => this.attempts.cancel(id)));
    await Promise.allSettled(this.queues.values());
  }

  async reconcile(): Promise<void> {
    const installed = new Set(
      this.options
        .readConnectors()
        .filter((connector) => googleConnectorForConfig(connector))
        .map((connector) => connector.id),
    );
    const records = await this.options.authorization.listConnections();
    const ids = new Set([
      ...this.generations.keys(),
      ...records
        .filter((record) => record.integrationId === GOOGLE_CONNECTOR_INTEGRATION_ID)
        .map((record) => record.connectionId),
    ]);
    await Promise.all([...ids].filter((id) => !installed.has(id)).map((id) => this.disconnect(id)));
  }
}

function reply(res: ServerResponse, status: number, message: string): void {
  const nonce = randomUUID();
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'`,
  });
  res.end(
    `<title>Otto Google sign-in</title><script nonce="${nonce}">history.replaceState(null, '', location.pathname)</script><p>${message}</p>`,
  );
}
