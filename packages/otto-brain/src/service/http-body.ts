import type { IncomingMessage, ServerResponse } from "node:http";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

/** Bounded bytes and total time, including slow/truncated request bodies. */
export function readObject(
  request: IncomingMessage,
  signal: AbortSignal,
  limit = 1024 * 1024,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      cleanup();
      // IncomingMessage can emit an error after its aborted notification.
      // The rejected reader no longer owns it, but that socket error must not
      // become an unhandled process error while the remaining body drains.
      const drainError = () => {};
      request.on("error", drainError);
      request.once("close", () => request.off("error", drainError));
      request.resume();
      reject(error);
    };
    const onError = () => fail(new RequestError(400, "Brain request stream failed"));
    const onAborted = () => fail(new RequestError(400, "Brain request was interrupted"));
    const onAbort = () => fail(signal.reason);
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new RequestError(413, "Brain request body is too large"));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new RequestError(400, "Expected a JSON object");
        resolve(body as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof RequestError ? error : new RequestError(400, "Invalid JSON body"));
      }
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export function requestLifetime(
  response: ServerResponse,
  parent: AbortSignal,
  timeoutMs = 15 * 60 * 1000,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const close = () => {
    if (!response.writableFinished) controller.abort(new Error("Brain client disconnected"));
  };
  response.once("close", close);
  return {
    signal: AbortSignal.any([controller.signal, parent, AbortSignal.timeout(timeoutMs)]),
    dispose() {
      response.off("close", close);
    },
  };
}
