import {
  CALLBACK_PATH,
  GrantError,
  GrantMachine,
  randomSecret,
  readJson,
  type GrantRecord,
} from "./grant";
import { resolveVendor, type VendorBindings } from "./vendors";
import { consentContent, renderAuthPage, statusContent } from "./pages";

interface Env extends VendorBindings {
  PUBLIC_ORIGIN: string;
  GRANTS: DurableObjectNamespace;
  REQUEST_LIMITER: RateLimit;
}

const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "strict-transport-security": "max-age=31536000",
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers });
}

function consentHeaders(authorizationOrigins: readonly string[]) {
  return {
    ...headers,
    "referrer-policy": "same-origin",
    "content-security-policy": headers["content-security-policy"].replace(
      "form-action 'self'",
      `form-action 'self' ${authorizationOrigins.join(" ")}`,
    ),
  };
}

function page(body: string, status = 200, authorizationOrigins?: readonly string[]): Response {
  const nonce = randomSecret();
  const pageHeaders = authorizationOrigins ? consentHeaders(authorizationOrigins) : headers;
  return new Response(renderAuthPage(body, nonce), {
    status,
    headers: {
      ...pageHeaders,
      "content-security-policy": `${pageHeaders["content-security-policy"]}; style-src 'nonce-${nonce}'`,
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function failure(error: unknown): Response {
  // Never serialize vendor bodies, exceptions, URLs, tokens, or request details.
  return json(
    { error: error instanceof GrantError ? error.code : "service_unavailable" },
    error instanceof GrantError ? error.status : 503,
  );
}

function stringField(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== "string") throw new GrantError("invalid_body");
  return body[name];
}

function callbackState(url: URL): RegExpExecArray {
  const state = /^([a-f0-9]{64})\.([\w-]{43})$/.exec(url.searchParams.get("state") ?? "");
  if (!state) throw new GrantError("invalid_attempt");
  return state;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.PUBLIC_ORIGIN) throw new GrantError("invalid_origin");
      if (url.pathname === "/health" && request.method === "GET")
        return json({ status: "ok", version: 1 });
      const browser = request.headers.get("origin");
      if (browser && browser !== env.PUBLIC_ORIGIN) throw new GrantError("invalid_origin", 403);
      if (
        !(
          await env.REQUEST_LIMITER.limit({
            key: request.headers.get("cf-connecting-ip") ?? "local",
          })
        ).success
      )
        throw new GrantError("rate_limited", 429);
      if (url.pathname === "/v1/grants" && request.method === "POST") {
        if (browser) throw new GrantError("daemon_required", 403);
        const body = await readJson(request, 1024);
        const vendorId = stringField(body, "vendorId");
        if (!resolveVendor(vendorId, env)) throw new GrantError("vendor_unavailable", 503);
        const id = env.GRANTS.newUniqueId();
        const result = await env.GRANTS.get(id).fetch(
          new Request(`${env.PUBLIC_ORIGIN}/internal/start`, {
            method: "POST",
            body: JSON.stringify({ vendorId, proofHash: stringField(body, "proofHash") }),
          }),
        );
        if (!result.ok) return result;
        return json(
          {
            grantId: id.toString(),
            authorizationUrl: `${env.PUBLIC_ORIGIN}/v1/grants/${id}/authorize`,
            expiresIn: 300,
          },
          201,
        );
      }
      const match = /^\/v1\/grants\/([a-f0-9]{64})\/(authorize|collect|refresh|revoke)$/.exec(
        url.pathname,
      );
      if (match) {
        if (match[2] !== "authorize" && browser) throw new GrantError("daemon_required", 403);
        return await env.GRANTS.get(env.GRANTS.idFromString(match[1])).fetch(request);
      }
      if (url.pathname === CALLBACK_PATH && request.method === "GET") {
        const state = callbackState(url);
        return await env.GRANTS.get(env.GRANTS.idFromString(state[1])).fetch(request);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;

/** One object per connection grant. This is metadata, not a central token vault.
 * Serialization includes token calls, so two refresh requests cannot rotate the
 * same grant concurrently. Crash recovery observes the persisted consuming stage.
 */
export class AuthGrant {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly machine: GrantMachine;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.machine = new GrantMachine(
      {
        get: () => ctx.storage.get<GrantRecord>("grant"),
        put: async (record) => {
          await ctx.storage.put("grant", record);
          await ctx.storage.setAlarm(record.expiresAt);
        },
        delete: async () => {
          await ctx.storage.deleteAll();
          await ctx.storage.deleteAlarm();
        },
      },
      (id) => resolveVendor(id, env),
      env.PUBLIC_ORIGIN,
    );
  }

  fetch(request: Request): Promise<Response> {
    const result = this.queue.then(() => this.handle(request)).catch(failure);
    this.queue = result;
    return result;
  }

  async alarm(): Promise<void> {
    const result = this.queue.then(async () => {
      const record = await this.ctx.storage.get<GrantRecord>("grant");
      if (!record || record.expiresAt <= Date.now()) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(record.expiresAt);
      return undefined;
    });
    this.queue = result.catch(() => undefined);
    await result;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/start" && request.method === "POST") {
      const body = await readJson(request, 1024);
      await this.machine.start(stringField(body, "vendorId"), stringField(body, "proofHash"));
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/authorize")) return this.authorizePage(request, url);
    if (url.pathname === CALLBACK_PATH && request.method === "GET") {
      await this.machine.callback(
        callbackState(url)[2],
        url.searchParams.get("code"),
        url.searchParams.has("error"),
      );
      return page(
        statusContent(
          "Access approved",
          "Return to Otto while your host finishes connecting. You can close this page. Otto will confirm when the tools are available.",
        ),
      );
    }
    if (request.method !== "POST" || request.headers.has("origin"))
      throw new GrantError("invalid_request");
    const proof = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (url.pathname.endsWith("/collect")) {
      const tokens = await this.machine.collect(proof);
      return tokens ? json({ tokens }) : json({ status: "pending" }, 202);
    }
    if (url.pathname.endsWith("/refresh")) {
      const body = await readJson(request);
      return json({ tokens: await this.machine.refresh(proof, stringField(body, "refreshToken")) });
    }
    if (url.pathname.endsWith("/revoke")) {
      const body = await readJson(request);
      await this.machine.revoke(
        proof,
        typeof body.refreshToken === "string" ? body.refreshToken : undefined,
      );
      return json({ ok: true });
    }
    throw new GrantError("not_found", 404);
  }

  private async authorizePage(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET") {
      const view = await this.machine.view();
      if (view.stage !== "consent")
        return page(
          statusContent(
            "Sign-in started",
            "Finish the vendor approval in the browser where you started it, or start again in Otto.",
          ),
        );
      return page(
        consentContent(view),
        200,
        // no-referrer turns a browser form POST's Origin into null. Preserve
        // same-origin consent while withholding referrers from other sites.
        view.authorizationOrigins,
      );
    }
    if (request.method === "POST" && request.headers.get("origin") === this.env.PUBLIC_ORIGIN) {
      const view = await this.machine.view();
      const target = await this.machine.authorize(
        this.ctx.id.toString(),
        url.searchParams.get("state") ?? "",
      );
      return new Response(null, {
        status: 303,
        headers: {
          // The redirect response must allow the same vendor destination as
          // the consent document; browsers enforce form-action across redirects.
          ...consentHeaders(view.authorizationOrigins),
          "referrer-policy": "no-referrer",
          location: target,
        },
      });
    }
    throw new GrantError("invalid_request");
  }
}
