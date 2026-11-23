import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  googleConnectorForConfig,
  type GoogleConnectorService,
} from "@getpaseo/plugin/otto/connectors";
import {
  ConnectorBundleSchema,
  ConnectorError,
  disconnectedConnectorBundle,
  type ConnectorBundle,
} from "../configuration.js";
import {
  McpOAuthSession,
  connectorAuthorizationFetch,
  type ConnectorOAuthSessionOptions,
} from "../oauth-session.js";
import type { ConnectorBrowserSession } from "../oauth-broker.js";
import { GOOGLE_CONNECTOR_IDENTITY_SCOPES } from "./google-connector-scopes.js";

const Registration = z.object({
  installed: z.object({
    client_id: z.string().endsWith(".apps.googleusercontent.com"),
    client_secret: z.string().min(1),
  }),
});
export type GoogleOAuthRegistration = z.infer<typeof Registration>["installed"];
const TokenSet = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().finite().positive(),
  scopes: z.array(z.string()),
});
const GoogleGrant = z.object({
  kind: z.literal("google-oauth-v1"),
  resourceUrl: z.string(),
  serviceId: z.string(),
  clientId: z.string().optional(),
  account: z.string().email().nullable(),
  tokens: TokenSet,
  refreshBlocked: z.boolean().optional(),
});
type GoogleGrant = z.infer<typeof GoogleGrant>;
const LegacyTokens = z.object({
  kind: z.literal("oauth-token-set-v1"),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  grantedScopes: z.array(z.string()),
});

/** Publisher registration is materialized in CI, never fetched onto a developer
 * machine. Loading it is lazy and never projects it to an app/model provider.
 */
export async function loadGoogleOAuthRegistration(): Promise<GoogleOAuthRegistration | null> {
  try {
    const location =
      process.env.OTTO_GOOGLE_OAUTH_CLIENT_FILE ??
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../../../../../dist/server/services/otto/connectors/google/google-oauth-client.json"
          : "./google-oauth-client.json",
        import.meta.url,
      );
    const bytes = await readFile(location, "utf8");
    if (bytes.length > 16384) return null;
    return Registration.parse(JSON.parse(bytes)).installed;
  } catch {
    return null;
  }
}
interface GooglePorts {
  registration(): Promise<GoogleOAuthRegistration | null>;
  legacyCredential?(connectionId: string): Promise<string | null>;
  legacyAccount?(connectionId: string): Promise<string | null>;
  now?: () => number;
}

/** Google shares the daemon callback lifecycle with DCR connectors, while using
 * its ordinary account OAuth/API protocol rather than pretending an API is MCP.
 */
export class GoogleOAuthSessions {
  constructor(private readonly ports: GooglePorts) {}
  async open(options: ConnectorOAuthSessionOptions): Promise<ConnectorBrowserSession> {
    const service = googleConnectorForConfig(options.bundle);
    if (!service) return McpOAuthSession.open(options);
    const version = await options.store.readBundleVersion(options.entry);
    const bundle =
      version.value === null
        ? options.bundle
        : ConnectorBundleSchema.parse(JSON.parse(version.value));
    let grant: GoogleGrant | null = null;
    if (bundle.authorization?.kind === "google-oauth-v1")
      grant = GoogleGrant.parse(bundle.authorization);
    else if (bundle.authorization?.kind !== "disconnected" && bundle.legacy) {
      // COMPAT(google09Grant): v0.10.0, remove after 2027-04-30. Read only the
      // same host's exact google-connectors tuple for this preserved connection.
      const original = await this.ports.legacyCredential?.(options.entry.id);
      if (original) {
        const old = LegacyTokens.parse(JSON.parse(original));
        grant = {
          kind: "google-oauth-v1",
          resourceUrl: service.url,
          serviceId: service.id,
          account: (await this.ports.legacyAccount?.(options.entry.id)) ?? null,
          tokens: {
            accessToken: old.accessToken,
            refreshToken: old.refreshToken,
            expiresAt: Date.parse(old.expiresAt),
            scopes: old.grantedScopes,
          },
        };
      }
    }
    if (grant && (grant.resourceUrl !== service.url || grant.serviceId !== service.id))
      throw new ConnectorError(
        "authorization",
        "The stored Google grant belongs to a different service. Reconnect this connector.",
      );
    return new GoogleSession(options, this.ports, service, bundle, version.revision, grant);
  }
}

class GoogleSession implements ConnectorBrowserSession {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly scopes: string[];
  private verifier: string | null = null;
  private consumed = false;
  constructor(
    private readonly options: ConnectorOAuthSessionOptions,
    private readonly ports: GooglePorts,
    private readonly service: GoogleConnectorService,
    private bundle: ConnectorBundle,
    private revision: string,
    private grant: GoogleGrant | null,
  ) {
    this.fetcher = connectorAuthorizationFetch(options.fetcher, options.signal);
    this.now = ports.now ?? Date.now;
    this.scopes = [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES];
  }
  private async assertActive() {
    this.options.signal?.throwIfAborted();
    if (!this.options.active())
      throw new ConnectorError("conflict", "This Google sign-in attempt is no longer active.");
    const current = await this.options.store.open(this.options.entry.id);
    const version = await this.options.store.readBundleVersion(this.options.entry);
    if (
      current.entry.generation !== this.options.entry.generation ||
      version.revision !== this.revision
    )
      throw new ConnectorError(
        "conflict",
        "The Google connection changed. Reload before signing in again.",
      );
  }
  private async registration(): Promise<GoogleOAuthRegistration> {
    const registration = await this.ports.registration();
    if (!registration)
      throw new ConnectorError(
        "unavailable",
        "Google sign-in is not configured in this host build. Use an Otto host build with publisher-managed Google sign-in.",
      );
    return registration;
  }
  async begin(): Promise<"REDIRECT"> {
    await this.assertActive();
    if (!this.options.interactive || !this.options.onRedirect)
      throw new ConnectorError("authorization", "Sign in to Google from Settings > Connectors.");
    const registration = await this.registration();
    this.verifier = randomBytes(48).toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: registration.client_id,
      redirect_uri: this.options.redirectUri,
      state: this.options.state,
      code_challenge: createHash("sha256").update(this.verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: this.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
    }).toString();
    this.options.onRedirect(url);
    return "REDIRECT";
  }
  private async exchange(
    body: Record<string, string>,
    previous?: GoogleGrant,
  ): Promise<z.infer<typeof TokenSet>> {
    const registration = await this.registration();
    if (previous?.clientId && previous.clientId !== registration.client_id)
      throw new ConnectorError(
        "authorization",
        "The publisher's Google client changed. Reconnect this account.",
      );
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...body,
        client_id: registration.client_id,
        client_secret: registration.client_secret,
      }),
    });
    if (!response.ok)
      throw new ConnectorError(
        "authorization",
        "Google authorization did not complete. Reconnect this account in Settings.",
      );
    const raw = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        token_type: z.string(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
      })
      .parse(await response.json());
    if (raw.token_type.toLowerCase() !== "bearer")
      throw new ConnectorError("authorization", "Google returned an unsupported token type.");
    const scopes = raw.scope?.split(/\s+/).filter(Boolean) ?? previous?.tokens.scopes ?? [];
    if (!this.scopes.every((scope) => scopes.includes(scope)))
      throw new ConnectorError(
        "authorization",
        "Approve the requested Google permissions to connect this service.",
      );
    return TokenSet.parse({
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token ?? previous?.tokens.refreshToken,
      expiresAt: this.now() + raw.expires_in * 1000,
      scopes,
    });
  }
  async complete(code: string): Promise<void> {
    await this.assertActive();
    if (this.consumed || !this.verifier)
      throw new ConnectorError(
        "authorization",
        "This Google code was already consumed or expired. Start sign-in again.",
      );
    this.consumed = true;
    try {
      const tokens = await this.exchange({
        grant_type: "authorization_code",
        code,
        code_verifier: this.verifier,
        redirect_uri: this.options.redirectUri,
      });
      const response = await this.fetcher("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok)
        throw new ConnectorError("authorization", "Google did not verify the signed-in account.");
      const profile = z
        .object({ email: z.string().email(), verified_email: z.literal(true) })
        .parse(await response.json());
      const registration = await this.registration();
      await this.save({
        kind: "google-oauth-v1",
        resourceUrl: this.service.url,
        serviceId: this.service.id,
        clientId: registration.client_id,
        account: profile.email,
        tokens,
      });
    } finally {
      this.verifier = null;
    }
  }
  private async save(grant: GoogleGrant) {
    await this.assertActive();
    const bundle = { ...this.bundle, authorization: grant };
    this.revision = await this.options.store.writeBundle(
      this.options.entry,
      this.revision,
      bundle,
      () => this.options.active() && !this.options.signal?.aborted,
    );
    this.bundle = bundle;
    this.grant = grant;
  }
  async access(): Promise<{ token: string; revision: string }> {
    await this.assertActive();
    if (this.grant?.refreshBlocked)
      throw new ConnectorError(
        "authorization",
        "Google authorization renewal did not finish. Review account access before reconnecting.",
      );
    if (!this.grant || !this.scopes.every((scope) => this.grant!.tokens.scopes.includes(scope)))
      throw new ConnectorError(
        "authorization",
        "Sign in to this Google service from Settings > Connectors.",
      );
    if (this.grant.tokens.expiresAt <= this.now() + 60000) {
      const previous = this.grant;
      await this.save({ ...previous, refreshBlocked: true });
      const tokens = await this.exchange(
        { grant_type: "refresh_token", refresh_token: previous.tokens.refreshToken },
        previous,
      );
      await this.save({ ...previous, tokens, refreshBlocked: false });
    }
    return { token: `Bearer ${this.grant.tokens.accessToken}`, revision: this.revision };
  }
  async disconnect(): Promise<void> {
    await this.assertActive();
    if (this.grant) {
      const response = await this.fetcher("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: this.grant.tokens.refreshToken }),
      });
      if (!response.ok) {
        const detail = z.object({ error: z.string() }).safeParse(await response.json());
        if (response.status !== 400 || !detail.success || detail.data.error !== "invalid_token")
          throw new ConnectorError(
            "uncertain",
            "Google revocation did not complete. Review account access before disconnecting again.",
          );
      }
    }
    await this.assertActive();
    const bundle = disconnectedConnectorBundle(this.bundle);
    this.revision = await this.options.store.writeBundle(
      this.options.entry,
      this.revision,
      bundle,
      () => this.options.active() && !this.options.signal?.aborted,
    );
    this.bundle = bundle;
    this.grant = null;
  }
  status() {
    const grant = this.grant;
    return {
      connected: Boolean(
        grant &&
        !grant.refreshBlocked &&
        this.scopes.every((scope) => grant.tokens.scopes.includes(scope)),
      ),
      account: grant?.account ?? null,
      scopes: grant?.tokens.scopes ?? [],
      message: grant?.refreshBlocked
        ? "Google authorization renewal did not finish. Review account access before reconnecting."
        : null,
    };
  }
}
