/** Local CLI/daemon control uses the exact private PID record and verified TLS. */
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import type { PidRecord } from "./pid-lock.js";
import { BrainHttpClient } from "./host-http-client.js";
import type { BrainHostEvent } from "./event-decoder.js";

export interface LocalBrainClientOptions {
  record: PidRecord;
  config: BrainConfig;
  env?: NodeJS.ProcessEnv;
}

function certificate(options: LocalBrainClientOptions): Buffer | undefined {
  if (options.record.secure && options.record.certificate)
    return Buffer.from(options.record.certificate);
  // COMPAT(brainActiveCertificate): added in v0.10.0, remove after 2027-04-23.
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
  // Exact private lifetime proof authorizes local stop, independently of a staged key rotation.
  if (route !== "/__host/local/stop" && config.auth.mode === "token" && config.auth.token)
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
          allowPartialTrustChain: Boolean(record.certificate),
          servername: record.displayHost ?? config.tls.hostname ?? "localhost",
        }
      : {}),
  };
}

/** One owner transport is reused for management JSON and events. */
export function localBrainClient(options: LocalBrainClientOptions): BrainHttpClient {
  return new BrainHttpClient((route, signal, payload, receive) => {
    const transport = options.record.secure ? https : http;
    return transport.request(localRequestOptions(options, route, signal, payload), receive);
  });
}

export async function localBrainRequest(
  options: LocalBrainClientOptions,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return localBrainClient(options).request(route, body, signal);
}

/** No reconnect or polling here: the owning demand store decides stream lifetime. */
export async function localBrainEvents(
  options: LocalBrainClientOptions,
  receive: (event: BrainHostEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return localBrainClient(options).events(receive, signal);
}
