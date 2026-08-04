/**
 * The small HTTP primitives the service layer shares.
 *
 * These lived inside `router.ts` while it was the only thing serving requests.
 * `host-api.ts` needs the same error envelope and the same bounded body reader,
 * and importing them back out of `router.ts` would make a cycle, so they sit
 * here. The error envelope is deliberately Anthropic-shaped: clients already
 * parse that from the completion proxy, so a management-endpoint failure does
 * not need a second error format.
 */
import type http from "node:http";

/** Headers that must not be forwarded across a proxy hop. */
export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function errorBody(status: number, message: string): string {
  return JSON.stringify({
    type: "error",
    error: { type: status === 503 ? "overloaded_error" : "api_error", message },
  });
}

export function sendJson(res: http.ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy();
    return;
  }
  const body = errorBody(status, message);
  const headers: http.OutgoingHttpHeaders = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  };
  if (status === 503) headers["retry-after"] = "5";
  res.writeHead(status, headers);
  res.end(body);
}

export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; error: string };

/** Buffer a bounded JSON request body. */
export function readJsonBody(
  req: http.IncomingMessage,
  limit: number,
  cb: (result: JsonBodyResult) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) tooBig = true;
    else chunks.push(chunk);
  });
  req.on("error", () => cb({ ok: false, error: "request stream error" }));
  req.on("end", () => {
    if (tooBig) {
      cb({ ok: false, error: "request body too large" });
      return;
    }
    try {
      const text = Buffer.concat(chunks).toString("utf8") || "{}";
      cb({ ok: true, body: JSON.parse(text) });
    } catch {
      cb({ ok: false, error: "invalid JSON body" });
    }
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
