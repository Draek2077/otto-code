/** Remote owner transport. Construction never reads a home or contacts a host. */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { Duplex } from "node:stream";
import { BrainHttpClient } from "./host-http-client.js";

export interface RemoteBrainClientOptions {
  host: string;
  port: number;
  secure: boolean;
  certFingerprint: string | null;
  authToken: string | null;
}
function normalizeFingerprint(raw: string): string {
  const value = raw.replace(/[:\s]/gu, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/u.test(value))
    throw new Error("Use a SHA-256 Brain certificate fingerprint");
  return value;
}

/** Never hand the HTTP layer a socket until the configured peer is authenticated. */
function connectPinned(
  options: RemoteBrainClientOptions,
  fingerprint: string,
  signal: AbortSignal,
  receive: (error: Error | null, socket: Duplex) => void,
): undefined {
  const socket = tls.connect({
    host: options.host,
    port: options.port,
    ...(isIP(options.host) ? {} : { servername: options.host }),
    // The certificate pin replaces CA/hostname identity only on this isolated socket.
    rejectUnauthorized: false,
  });
  let settled = false;
  const finish = (error: Error | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", aborted);
    if (error) socket.destroy();
    receive(error, socket);
  };
  const aborted = () => finish(new Error("Brain TLS connection canceled"));
  const timer = setTimeout(() => finish(new Error("Brain TLS handshake timed out")), 5000);
  timer.unref();
  signal.addEventListener("abort", aborted, { once: true });
  socket.once("error", (error) => finish(error));
  socket.once("secureConnect", () => {
    const presented = socket.getPeerCertificate().fingerprint256;
    if (!presented || normalizeFingerprint(presented) !== fingerprint) {
      finish(new Error("Brain certificate does not match the configured fingerprint"));
      return;
    }
    finish(null);
  });
  if (signal.aborted) aborted();
  return undefined;
}

export function remoteBrainClient(input: RemoteBrainClientOptions): BrainHttpClient {
  const options = { ...input };
  // domainToASCII parses URL-like input and can silently discard a path or port.
  if (!isIP(options.host) && /[/\\@:?#%\s]/u.test(options.host))
    throw new Error("Use a Brain hostname or IP address without a URL or path");
  const host = isIP(options.host) ? options.host : domainToASCII(options.host);
  if (!host || (!isIP(host) && !/^[A-Za-z0-9._-]{1,253}$/u.test(host)))
    throw new Error("Use a Brain hostname or IP address without a URL or path");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    throw new Error("Use a valid Brain port");
  if (
    options.authToken !== null &&
    (!options.authToken ||
      options.authToken.length > 16384 ||
      [...options.authToken].some(
        (letter) => letter.charCodeAt(0) <= 32 || letter.charCodeAt(0) === 127,
      ))
  )
    throw new Error("Use a nonblank Brain access key without control characters");
  if (!options.secure && options.certFingerprint !== null)
    throw new Error("A Brain certificate fingerprint requires HTTPS");
  options.host = host;
  const fingerprint =
    options.certFingerprint === null ? null : normalizeFingerprint(options.certFingerprint);
  return new BrainHttpClient((route, signal, payload, receive) => {
    if (!route.startsWith("/") || route.startsWith("//") || /[\r\n]/u.test(route))
      throw new Error("Invalid Brain route");
    const request: http.RequestOptions = {
      hostname: host,
      port: options.port,
      path: route,
      method: payload ? "POST" : "GET",
      signal,
      headers: {
        ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}),
        ...(payload
          ? { "content-type": "application/json", "content-length": payload.length }
          : {}),
      },
    };
    if (!options.secure) return http.request(request, receive);
    if (fingerprint)
      return http.request(
        {
          ...request,
          createConnection: (_connectOptions, callback) =>
            connectPinned(options, fingerprint, signal, callback),
        },
        receive,
      );
    return https.request(request, receive);
  });
}
