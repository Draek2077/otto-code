import type { Vendor } from "./vendors";

export const ATTEMPT_TTL = 5 * 60_000;
export const GRANT_TTL = 90 * 24 * 60 * 60_000;
export const CALLBACK_PATH = "/v1/callback";
const TOKEN_LIMIT = 32_768;

export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function digest(value: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

export class GrantError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
  }
}

export interface GrantRecord {
  vendorId: string;
  proofHash: string;
  state: string;
  verifier?: string;
  code?: string;
  refreshHash?: string;
  stage:
    | "consent"
    | "waiting"
    | "ready"
    | "exchanging"
    | "active"
    | "refreshing"
    | "revoking"
    | "failed";
  expiresAt: number;
}

export interface GrantStore {
  get(): Promise<GrantRecord | undefined>;
  put(record: GrantRecord): Promise<void>;
  delete(): Promise<void>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

/** Calls are serialized by the Durable Object adapter, including external awaits.
 * Persist the consuming stage BEFORE fetching. A crash or lost response forces
 * reauthorization; consumed codes/rotating refresh tokens are never replayed.
 */
export class GrantMachine {
  constructor(
    private readonly store: GrantStore,
    private readonly vendor: (id: string) => Vendor | null,
    private readonly origin: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async start(vendorId: string, proofHash: string): Promise<void> {
    if (await this.store.get()) throw new GrantError("conflict", 409);
    if (!this.vendor(vendorId)) throw new GrantError("vendor_unavailable", 503);
    if (!/^[\w-]{43}$/.test(proofHash)) throw new GrantError("invalid_proof");
    await this.store.put({
      vendorId,
      proofHash,
      state: randomSecret(),
      verifier: randomSecret(),
      stage: "consent",
      expiresAt: this.now() + ATTEMPT_TTL,
    });
  }

  async view(): Promise<{
    vendor: string;
    authorizationOrigins: string[];
    scopes: string;
    state: string;
    stage: GrantRecord["stage"];
  }> {
    const record = await this.record();
    const vendor = this.requireVendor(record);
    return {
      vendor: vendor.name,
      authorizationOrigins: [
        new URL(vendor.authorizeUrl).origin,
        ...(vendor.authorizationRedirectOrigins ?? []),
      ],
      scopes: vendor.scopeDescription,
      state: record.state,
      stage: record.stage,
    };
  }

  async authorize(id: string, state: string): Promise<string> {
    const record = await this.record();
    if (state !== record.state || record.stage !== "consent")
      throw new GrantError("invalid_attempt");
    const vendor = this.requireVendor(record);
    const url = new URL(vendor.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: vendor.clientId,
      response_type: "code",
      redirect_uri: this.origin + CALLBACK_PATH,
      scope: vendor.scopes,
      state: `${id}.${record.state}`,
      code_challenge: await digest(record.verifier!),
      code_challenge_method: "S256",
    }).toString();
    await this.store.put({ ...record, stage: "waiting" });
    return url.toString();
  }

  async callback(state: string, code: string | null, denied: boolean): Promise<void> {
    const record = await this.record();
    if (state !== record.state || record.stage !== "waiting")
      throw new GrantError("invalid_attempt");
    if (denied || !code || code.length > 4096) {
      await this.store.put({ ...record, stage: "failed", verifier: undefined });
      throw new GrantError("authorization_denied");
    }
    // Short-lived authorization code, not an access/refresh token. Purged on
    // collection or the attempt alarm. Disclose this temporary storage.
    await this.store.put({ ...record, code, stage: "ready" });
  }

  async collect(proof: string): Promise<TokenSet | null> {
    const record = await this.authenticate(proof);
    if (record.stage === "waiting" || record.stage === "consent") return null;
    if (record.stage !== "ready") throw new GrantError("reconnect_required", 409);
    const vendor = this.requireVendor(record);
    await this.store.put({ ...record, stage: "exchanging", code: undefined, verifier: undefined });
    const tokens = await this.exchange(vendor, {
      grant_type: "authorization_code",
      code: record.code!,
      code_verifier: record.verifier!,
      redirect_uri: this.origin + CALLBACK_PATH,
    });
    await this.store.put({
      ...record,
      stage: "active",
      code: undefined,
      verifier: undefined,
      refreshHash: await digest(tokens.refreshToken),
      expiresAt: this.now() + GRANT_TTL,
    });
    return tokens;
  }

  async refresh(proof: string, refreshToken: string): Promise<TokenSet> {
    const record = await this.authenticate(proof);
    await this.matchRefresh(record, refreshToken);
    const vendor = this.requireVendor(record);
    await this.store.put({ ...record, stage: "refreshing" });
    const tokens = await this.exchange(vendor, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    await this.store.put({
      ...record,
      stage: "active",
      refreshHash: await digest(tokens.refreshToken),
      expiresAt: this.now() + GRANT_TTL,
    });
    return tokens;
  }

  async revoke(proof: string, refreshToken?: string): Promise<void> {
    const record = await this.authenticate(proof);
    if (!record.refreshHash) {
      await this.store.delete();
      return;
    }
    await this.matchRefresh(record, refreshToken ?? "");
    const vendor = this.requireVendor(record);
    await this.store.put({ ...record, stage: "revoking" });
    let response: Response;
    try {
      response = await this.fetcher(vendor.revokeUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: vendor.clientId,
          client_secret: vendor.clientSecret,
          token: refreshToken!,
        }),
      });
    } catch {
      throw new GrantError("revocation_unconfirmed", 502);
    }
    if (!response.ok) throw new GrantError("revocation_unconfirmed", 502);
    await this.store.delete();
  }

  private async matchRefresh(record: GrantRecord, token: string): Promise<void> {
    if (
      record.stage !== "active" ||
      !token ||
      token.length > TOKEN_LIMIT ||
      (await digest(token)) !== record.refreshHash
    )
      throw new GrantError("reconnect_required", 409);
  }

  private requireVendor(record: GrantRecord): Vendor {
    const vendor = this.vendor(record.vendorId);
    if (!vendor) throw new GrantError("vendor_unavailable", 503);
    return vendor;
  }

  private async record(): Promise<GrantRecord> {
    const record = await this.store.get();
    if (!record || record.expiresAt <= this.now()) {
      await this.store.delete();
      throw new GrantError("expired", 410);
    }
    return record;
  }

  private async authenticate(proof: string): Promise<GrantRecord> {
    const record = await this.record();
    if (!/^[\w-]{43}$/.test(proof) || (await digest(proof)) !== record.proofHash)
      throw new GrantError("unauthorized", 401);
    return record;
  }

  private async exchange(vendor: Vendor, fields: Record<string, string>): Promise<TokenSet> {
    try {
      const response = await this.fetcher(vendor.tokenUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...fields,
          client_id: vendor.clientId,
          client_secret: vendor.clientSecret,
        }),
      });
      if (!response.ok) throw new Error();
      const value = await readJson(response, 65_536);
      if (
        typeof value.access_token !== "string" ||
        !value.access_token ||
        value.access_token.length > TOKEN_LIMIT ||
        typeof value.refresh_token !== "string" ||
        !value.refresh_token ||
        value.refresh_token.length > TOKEN_LIMIT ||
        typeof value.expires_in !== "number" ||
        !Number.isFinite(value.expires_in) ||
        value.expires_in <= 0 ||
        value.expires_in > 31_536_000 ||
        value.token_type?.toString().toLowerCase() !== "bearer"
      )
        throw new Error();
      const scopes =
        typeof value.scope === "string"
          ? value.scope.split(/\s+/).filter(Boolean)
          : vendor.scopes.split(" ");
      if (scopes.some((scope) => !vendor.scopes.split(" ").includes(scope))) throw new Error();
      return {
        accessToken: value.access_token,
        refreshToken: value.refresh_token,
        expiresAt: this.now() + value.expires_in * 1000,
        scopes,
      };
    } catch {
      throw new GrantError("reconnect_required", 502);
    }
  }
}

export async function readJson(
  input: Request | Response,
  limit = 65_536,
): Promise<Record<string, unknown>> {
  if (!input.body) throw new GrantError("invalid_body");
  const reader = input.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new GrantError("body_too_large", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new GrantError("invalid_body");
  }
}
