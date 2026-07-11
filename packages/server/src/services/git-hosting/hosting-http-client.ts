import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import {
  GitHostingAuthenticationError,
  GitHostingRateLimitError,
  GitHostingRequestError,
} from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export interface HostingHttpClientOptions {
  providerId: GitHostingProviderId;
  baseUrl: string;
  // Built per request and never stored on errors or logs.
  buildAuthorizationHeader: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  setTimeoutMs?: number;
}

export interface HostingHttpRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface HostingHttpClient {
  request(input: HostingHttpRequest): Promise<unknown>;
}

// HTTPS JSON client with the abuse guardrails all hosting providers share:
// - hard request timeout;
// - at most ONE retry, only for GET, only on 429/5xx, honoring Retry-After
//   with a cap — mutations are never retried;
// - a cooldown window after a rate-limit response during which requests fail
//   fast instead of hammering the API;
// - credentials appear only in the outgoing header; errors carry method,
//   path, and status, never headers or bodies.
export function createHostingHttpClient(options: HostingHttpClientOptions): HostingHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.setTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let cooldownUntil = 0;

  if (!options.baseUrl.startsWith("https://")) {
    throw new Error("Git hosting API base URL must use https");
  }

  function buildUrl(input: HostingHttpRequest): URL {
    const url = new URL(options.baseUrl.replace(/\/+$/u, "") + input.path);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  function parseRetryAfterMs(response: Response): number | null {
    const header = response.headers.get("retry-after");
    if (!header) {
      return null;
    }
    const seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  async function performOnce(input: HostingHttpRequest): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(buildUrl(input), {
        method: input.method,
        headers: {
          Authorization: options.buildAuthorizationHeader(),
          Accept: "application/json",
          ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GitHostingRequestError({
          method: input.method,
          path: input.path,
          status: null,
          detail: `timed out after ${timeoutMs}ms`,
        });
      }
      throw new GitHostingRequestError({
        method: input.method,
        path: input.path,
        status: null,
        detail: error instanceof Error ? error.message : "network error",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(response: Response, input: HostingHttpRequest): Promise<unknown> {
    if (response.status === 204) {
      return null;
    }
    try {
      return await response.json();
    } catch {
      throw new GitHostingRequestError({
        method: input.method,
        path: input.path,
        status: response.status,
        detail: "invalid JSON response",
      });
    }
  }

  return {
    async request(input: HostingHttpRequest): Promise<unknown> {
      const currentTime = now();
      if (currentTime < cooldownUntil) {
        throw new GitHostingRateLimitError({
          providerId: options.providerId,
          retryAfterMs: cooldownUntil - currentTime,
        });
      }

      let response = await performOnce(input);

      const isRetryable =
        input.method === "GET" && (response.status === 429 || response.status >= 500);
      if (isRetryable) {
        const retryAfterMs = parseRetryAfterMs(response) ?? 2_000;
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        response = await performOnce(input);
      }

      if (response.status === 429) {
        // Floor the cooldown: a zero or missing Retry-After must not let
        // callers keep hammering a rate-limited API.
        cooldownUntil = now() + Math.max(parseRetryAfterMs(response) ?? 0, RATE_LIMIT_COOLDOWN_MS);
        throw new GitHostingRateLimitError({
          providerId: options.providerId,
          retryAfterMs: cooldownUntil - now(),
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new GitHostingAuthenticationError(options.providerId);
      }

      if (!response.ok) {
        throw new GitHostingRequestError({
          method: input.method,
          path: input.path,
          status: response.status,
        });
      }

      return readJson(response, input);
    },
  };
}
