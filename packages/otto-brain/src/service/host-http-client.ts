/** Shared bounded JSON/SSE handling; the selected owner supplies transport trust. */
import type http from "node:http";
import { StringDecoder } from "node:string_decoder";
import { BrainEventDecoder, type BrainHostEvent } from "./event-decoder.js";

export type BrainHttpDispatch = (
  route: string,
  signal: AbortSignal,
  payload: Buffer | undefined,
  receive: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

/** The payload is untrusted until the owning operation validates its error contract. */
export class BrainHttpResponseError extends Error {
  constructor(
    readonly status: number,
    readonly response: unknown,
  ) {
    super(`Brain management request failed (${status})`);
  }
}

export class BrainHttpClient {
  constructor(private readonly dispatch: BrainHttpDispatch) {}

  async request(route: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > 128 * 1024)
      throw new Error("Brain management request exceeded its byte limit");
    const lifetime = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000);
    return new Promise((resolve, reject) => {
      const request = this.dispatch(route, lifetime, payload, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024)
            request.destroy(new Error("Brain management response exceeded its byte limit"));
          else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          let data: unknown;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            reject(new Error("Invalid Brain management response"));
            return;
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new BrainHttpResponseError(response.statusCode ?? 0, data));
            return;
          }
          resolve(data);
        });
      });
      request.once("error", reject);
      request.end(payload);
    });
  }

  /** Reconnection and consumer demand belong to BrainStatusStore. */
  async events(receive: (event: BrainHostEvent) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = this.dispatch("/__host/events", signal, undefined, (response) => {
        clearTimeout(handshake);
        if (
          response.statusCode !== 200 ||
          !response.headers["content-type"]?.startsWith("text/event-stream")
        ) {
          response.destroy();
          reject(new Error("Brain host event stream is unavailable"));
          return;
        }
        const utf8 = new StringDecoder("utf8");
        const decoder = new BrainEventDecoder(receive);
        response.on("data", (chunk: Buffer) => {
          try {
            decoder.push(utf8.write(chunk));
          } catch (error) {
            request.destroy(
              error instanceof Error ? error : new Error("Invalid Brain event stream"),
            );
          }
        });
        response.once("error", reject);
        response.once("end", resolve);
      });
      const handshake = setTimeout(
        () => request.destroy(new Error("Brain event handshake timed out")),
        5000,
      );
      handshake.unref();
      request.setTimeout(45000, () =>
        request.destroy(new Error("Brain event heartbeat timed out")),
      );
      request.once("close", () => clearTimeout(handshake));
      request.once("error", reject);
      request.end();
    });
  }
}
