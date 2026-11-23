import {
  atlassianFailure as failure,
  type AtlassianError,
  type AtlassianResult as Result,
} from "./result.js";
import { atlassianApiBase, type AtlassianCredential } from "./credentials.js";

type Method = "GET" | "POST" | "PUT";
export type AtlassianWriteResult =
  | { status: "applied"; value: unknown }
  | { status: "rejected" | "uncertain"; error: AtlassianError };
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
function requestUrl(credential: AtlassianCredential, endpoint: string): string | null {
  const base = atlassianApiBase(credential);
  if (
    !base ||
    !/^\/rest\/(agile\/1\.0|software\/1\.0|api\/3)\//.test(endpoint) ||
    Array.from(endpoint).some(
      (character) => character.charCodeAt(0) <= 32 || character === "\\" || character === "#",
    ) ||
    endpoint.includes("..")
  )
    return null;
  return base + endpoint;
}
function statusFailure(status: number): Result<never> {
  if (status === 401)
    return failure(
      "auth_required",
      "Reconnect the shared Atlassian account on this host. Its API token may be expired.",
    );
  if (status === 403)
    return failure(
      "access_denied",
      "The shared Atlassian account lacks permission for this Jira operation.",
    );
  if (status === 404)
    return failure("not_found", "The Jira board or issue is missing or inaccessible.");
  if (status === 429)
    return failure(
      "rate_limited",
      "Jira's request limit was reached. Retry the read later; reconcile any pending write first.",
    );
  if (status >= 300 && status < 400)
    return failure(
      "access_denied",
      "Jira redirected the request. Check the selected site's connection settings.",
    );
  if (status === 400 || status === 422)
    return failure(
      "invalid_target",
      "Jira rejected the fields or workflow action. Refresh its current editing metadata.",
    );
  return failure("unavailable", "Jira could not complete this request on the owning host.");
}
async function body(response: Response): Promise<Result<unknown>> {
  if (response.status === 204) return { ok: true, value: null };
  const reader = response.body?.getReader();
  if (!reader) return failure("invalid_response", "Jira returned an empty response.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return failure("read_limit", "Jira returned more than Otto's 10 MiB response limit.");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return failure("invalid_response", "Jira returned an incomplete or invalid response.");
  } finally {
    reader.releaseLock();
  }
}
/** A credential-bound server transport. No redirects, retries, polling or credential persistence. */
export function createAtlassianHttp(ports: {
  credential: AtlassianCredential;
  fetch?: typeof fetch;
}) {
  const transport = ports.fetch ?? fetch;
  async function request(method: Method, url: string, value?: unknown): Promise<Result<unknown>> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization:
          "Basic " +
          Buffer.from(ports.credential.email + ":" + ports.credential.apiToken).toString("base64"),
      };
      if (value !== undefined) headers["Content-Type"] = "application/json";
      const response = await transport(url, {
        method,
        headers,
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return statusFailure(response.status);
      }
      return await body(response);
    } catch {
      return failure("unavailable", "The Jira request timed out or its connection was lost.");
    }
  }
  return {
    async read(endpoint: string): Promise<Result<unknown>> {
      const url = requestUrl(ports.credential, endpoint);
      if (!url)
        return failure(
          "invalid_target",
          "Configure a valid shared Atlassian site and API-token route on this host.",
        );
      return request("GET", url);
    },
    async write(
      method: "POST" | "PUT",
      endpoint: string,
      value: unknown,
    ): Promise<AtlassianWriteResult> {
      const url = requestUrl(ports.credential, endpoint);
      if (!url)
        return {
          status: "rejected",
          error: {
            code: "invalid_target",
            message: "Configure a valid shared Atlassian site and API-token route on this host.",
          },
        };
      const response = await request(method, url, value);
      return response.ok
        ? { status: "applied", value: response.value }
        : { status: "uncertain", error: response.error };
    },
  };
}
export type AtlassianHttp = ReturnType<typeof createAtlassianHttp>;
