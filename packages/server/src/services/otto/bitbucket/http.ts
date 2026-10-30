import type { z } from "zod";

export interface BitbucketCredential {
  revision: string;
  email: string;
  apiToken: string;
}
export class BitbucketError extends Error {
  constructor(
    readonly kind:
      | "credentials"
      | "forbidden"
      | "not_found"
      | "rate_limit"
      | "invalid"
      | "unsupported"
      | "unavailable"
      | "uncertain",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "BitbucketError";
  }
}
const BASE = "https://api.bitbucket.org/2.0";
const MAX_BYTES = 10 * 1024 * 1024;
type Method = "GET" | "POST" | "PUT" | "DELETE";
function failure(status: number, writing: boolean): BitbucketError {
  if (status === 401)
    return new BitbucketError(
      "credentials",
      "Reconnect the Bitbucket account on this host. Its API token was rejected.",
      status,
    );
  if (status === 403)
    return new BitbucketError(
      "forbidden",
      "The selected Bitbucket account lacks permission or the required API-token scopes for this operation.",
      status,
    );
  if (status === 404)
    return new BitbucketError(
      "not_found",
      "The Bitbucket repository or pull request is missing or inaccessible to the selected account.",
      status,
    );
  if (status === 429)
    return new BitbucketError(
      "rate_limit",
      "Bitbucket's request limit was reached. Wait before refreshing; check the remote state before repeating a write.",
      status,
    );
  return new BitbucketError(
    writing && status >= 500 ? "uncertain" : "unavailable",
    writing
      ? "Bitbucket could not confirm the change. Refresh its remote state before trying again."
      : "Bitbucket could not complete the request.",
    status,
  );
}
async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  if (!reader) throw new BitbucketError("invalid", "Bitbucket returned an empty response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new BitbucketError("invalid", "Bitbucket's response exceeded Otto's 10 MiB limit.");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}
function apiUrl(endpoint: string): URL {
  const url = new URL(endpoint, BASE + "/");
  if (
    url.origin !== "https://api.bitbucket.org" ||
    !url.pathname.startsWith("/2.0/") ||
    url.username ||
    url.password ||
    url.hash ||
    /%2f|%5c|%2e/i.test(url.pathname)
  )
    throw new BitbucketError("invalid", "Bitbucket returned an unsafe API destination.");
  return url;
}
/** Credential-bound REST 2.0 transport. No redirects, write retries, or raw vendor errors. */
export function createBitbucketHttp(ports: {
  credential: BitbucketCredential;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const transport = ports.fetch ?? fetch;
  const now = ports.now ?? Date.now;
  let resumeAt = 0;
  async function request(method: Method, endpoint: string, value?: unknown): Promise<unknown> {
    const url = apiUrl(endpoint);
    if (resumeAt > now()) throw failure(429, method !== "GET");
    try {
      const response = await transport(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/json",
          Authorization:
            "Basic " +
            Buffer.from(ports.credential.email + ":" + ports.credential.apiToken).toString(
              "base64",
            ),
          ...(value === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const after = response.headers.get("retry-after");
          const seconds = after === null ? NaN : Number(after);
          const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after ?? "") - now();
          resumeAt =
            now() + Math.min(300_000, Math.max(1000, Number.isFinite(delay) ? delay : 60_000));
        }
        await response.body?.cancel();
        throw failure(response.status, method !== "GET");
      }
      return await readBody(response);
    } catch (error) {
      if (error instanceof BitbucketError) throw error;
      throw new BitbucketError(
        method === "GET" ? "unavailable" : "uncertain",
        method === "GET"
          ? "The Bitbucket response was invalid, timed out, or disconnected."
          : "The Bitbucket write outcome is unknown. Refresh the remote state before trying again.",
      );
    }
  }
  async function page<T>(
    endpoint: string,
    schema: z.ZodType<T>,
    maximum = 500,
  ): Promise<{ values: T[]; truncated: boolean }> {
    const root = apiUrl(endpoint);
    const seen = new Set<string>();
    const values: T[] = [];
    let next: string | null = root.href;
    for (let count = 0; next && count < 10; count++) {
      const url = apiUrl(next);
      if (url.pathname !== root.pathname || seen.has(url.href))
        throw new BitbucketError(
          "invalid",
          "Bitbucket returned invalid pagination for this resource.",
        );
      seen.add(url.href);
      const raw = await request("GET", url.href);
      if (!raw || typeof raw !== "object" || !("values" in raw) || !Array.isArray(raw.values))
        throw new BitbucketError("invalid", "Bitbucket returned an invalid resource list.");
      for (const row of raw.values) {
        const parsed = schema.safeParse(row);
        if (!parsed.success)
          throw new BitbucketError("invalid", "Bitbucket returned an invalid resource record.");
        if (values.length === maximum) return { values, truncated: true };
        values.push(parsed.data);
      }
      const link = "next" in raw ? raw.next : null;
      if (link != null && typeof link !== "string")
        throw new BitbucketError("invalid", "Bitbucket returned invalid pagination.");
      next = link || null;
      if (next) {
        const destination = apiUrl(next);
        if (destination.pathname !== root.pathname)
          throw new BitbucketError("invalid", "Bitbucket pagination changed resource.");
      }
      if (values.length >= maximum) return { values, truncated: next !== null };
    }
    return { values, truncated: next !== null };
  }
  return { request, page };
}
export type BitbucketHttp = ReturnType<typeof createBitbucketHttp>;

export function bitbucketPath(workspace: string, repository?: string): string {
  const parts = repository === undefined ? [workspace] : [workspace, repository];
  if (
    parts.some((part) => !/^[a-zA-Z0-9_{}.-]{1,256}$/.test(part) || part === "." || part === "..")
  )
    throw new BitbucketError("invalid", "Choose a valid Bitbucket workspace and repository.");
  return "/2.0/repositories/" + parts.map(encodeURIComponent).join("/");
}
export function bitbucketNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new BitbucketError("invalid", "Choose a valid Bitbucket pull request.");
  return value;
}
export function bitbucketText(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
