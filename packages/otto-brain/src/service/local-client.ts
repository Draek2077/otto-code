/** Local CLI/daemon control uses the exact private PID record and verified TLS. */
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import type { PidRecord } from "./pid-lock.js";
import { StringDecoder } from "node:string_decoder";
import { BrainEventDecoder, type BrainHostEvent } from "./event-decoder.js";

export interface LocalBrainClientOptions {
  record: PidRecord;
  config: BrainConfig;
  env?: NodeJS.ProcessEnv;
}

function certificate(options: LocalBrainClientOptions): Buffer | undefined {
  if (!options.record.secure || options.config.tls.mode === "tailscale") return undefined;
  if (options.config.tls.mode === "files") {
    if (!options.config.tls.certFile) throw new Error("Brain TLS certificate is not configured");
    return readFileSync(options.config.tls.certFile);
  }
  const hostname = options.config.tls.hostname ?? options.record.displayHost ?? "localhost";
  return readFileSync(
    path.join(
      options.config.tls.certDir ?? path.join(resolveBrainPaths(options.env).root, "certs"),
      `${hostname}.crt`,
    ),
  );
}

function localRequestOptions(
  options: LocalBrainClientOptions,
  route: string,
  signal: AbortSignal,
  payload?: Buffer,
): https.RequestOptions {
  if (!route.startsWith("/") || route.startsWith("//")) throw new Error("Invalid Brain route");
  const { record, config } = options;
  let host = record.host;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::") host = "::1";
  const headers: http.OutgoingHttpHeaders = {};
  if (config.auth.mode === "token" && config.auth.token)
    headers.authorization = `Bearer ${config.auth.token}`;
  if (payload) {
    headers["content-type"] = "application/json";
    headers["content-length"] = payload.length;
  }
  return {
    hostname: host,
    port: record.port,
    path: route,
    method: payload ? "POST" : "GET",
    headers,
    signal,
    ...(record.secure
      ? {
          ca: certificate(options),
          servername: record.displayHost ?? config.tls.hostname ?? "localhost",
        }
      : {}),
  };
}

export async function localBrainRequest(
  options: LocalBrainClientOptions,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const lifetime = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
    : AbortSignal.timeout(5000);
  const transport = options.record.secure ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      localRequestOptions(options, route, lifetime, payload),
      (response) => {
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
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Brain management request failed (${response.statusCode ?? 0})`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          } catch {
            reject(new Error("Invalid Brain management response"));
          }
        });
      },
    );
    request.once("error", reject);
    request.end(payload);
  });
}

/** No reconnect or polling here: the owning demand store decides stream lifetime. */
export async function localBrainEvents(
  options: LocalBrainClientOptions,
  receive: (event: BrainHostEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const transport = options.record.secure ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      localRequestOptions(options, "/__host/events", signal),
      (response) => {
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
      },
    );
    const handshake = setTimeout(
      () => request.destroy(new Error("Brain event handshake timed out")),
      5000,
    );
    handshake.unref();
    request.setTimeout(45000, () => request.destroy(new Error("Brain event heartbeat timed out")));
    request.once("close", () => clearTimeout(handshake));
    request.once("error", reject);
    request.end();
  });
}
