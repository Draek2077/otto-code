/** HTTP boundary for Otto-owned Google/Microsoft tools. Tokens stay in the
 * daemon; operations choose fixed vendor URLs, never model-provided URLs.
 */
export interface OfficeApiRequest {
  url: string;
  method?: "GET" | "POST" | "PATCH" | "PUT";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  text?: boolean;
}

export type OfficeApi = (request: OfficeApiRequest) => Promise<unknown>;

export class OfficeApiError extends Error {
  constructor(readonly status: number) {
    const messages: Record<number, string> = {
      401: "Sign in to this connector again.",
      403: "The account did not grant access to this operation or resource.",
      404: "The requested item was not found or is no longer accessible.",
      429: "The service is busy. Try again later.",
    };
    super(messages[status] ?? `The service request failed (HTTP ${status}).`);
    this.name = "OfficeApiError";
  }
}

export function createOfficeApi(params: {
  family: "google" | "microsoft";
  accessToken(): Promise<string>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): OfficeApi {
  return async (request) => {
    const url = new URL(request.url);
    const origins =
      params.family === "google"
        ? [
            "https://www.googleapis.com",
            "https://gmail.googleapis.com",
            "https://docs.googleapis.com",
          ]
        : ["https://graph.microsoft.com"];
    if (!origins.includes(url.origin) || url.username || url.password) {
      throw new Error("Unsupported service endpoint.");
    }
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const token = await params.accessToken();
    params.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await (params.fetch ?? fetch)(url, {
        method: request.method ?? "GET",
        redirect: "error",
        signal: params.signal
          ? AbortSignal.any([params.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(request.body !== undefined || request.bytes
            ? { "Content-Type": request.contentType ?? "application/json" }
            : {}),
        },
        body: requestBody(request),
      });
    } catch {
      // No automatic replay: a timeout can follow a successful email send.
      throw new Error(
        "The service request did not complete. Check whether a write succeeded before repeating it.",
      );
    }
    return readOfficeResponse(response, request.text);
  };
}

function requestBody(request: OfficeApiRequest): ArrayBuffer | string | undefined {
  if (request.bytes) return new Uint8Array(request.bytes).buffer;
  if (request.body !== undefined) return JSON.stringify(request.body);
  return undefined;
}

async function readOfficeResponse(response: Response, asText?: boolean): Promise<unknown> {
  if (!response.ok) throw new OfficeApiError(response.status);
  if (response.status === 204 || response.status === 202) return { accepted: true };
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 12 * 1024 * 1024)
        throw new Error(
          "The service response is too large. Request fewer items or a smaller file.",
        );
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const content = Buffer.concat(chunks).toString("utf8");
  if (asText) return content;
  if (!content) return { accepted: true };
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("The service returned an invalid JSON response.");
  }
}
