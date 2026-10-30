import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ConnectorTransport } from "@getpaseo/plugin/otto/connectors";
import { ConnectorError } from "./configuration.js";
import { ConnectorStore } from "./store.js";
import { McpOAuthSession, type ConnectorOAuthSessionOptions } from "./oauth-session.js";
import { getConnectorOAuthRegistration } from "./oauth-registration.js";

type Opened = Awaited<ReturnType<ConnectorStore["open"]>>;
export interface ConnectorBrowserSession {
  begin(): Promise<"AUTHORIZED" | "REDIRECT">;
  complete(code: string): Promise<void>;
  access(): Promise<{ token: string; revision: string }>;
  disconnect(): Promise<void>;
  status(): {
    connected: boolean;
    account: string | null;
    scopes: string[];
    message: string | null;
  };
}
interface Flow {
  id: string;
  attempt: string;
  state: string;
  entry: Opened["entry"];
  server: Server;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  session: ConnectorBrowserSession | null;
  accepted: boolean;
  callbackPath: string;
}
interface BrokerPorts {
  store: Pick<ConnectorStore, "open" | "readBundleVersion" | "writeBundle">;
  settled(
    id: string,
    generation: string,
    outcome: { connected: true } | { connected: false; message: string },
    admit: () => boolean,
  ): Promise<void>;
  fetcher?: typeof fetch;
  callbackPort?: number;
  callbackPortFor?(opened: Opened): number | undefined;
  callbackPathFor?(opened: Opened): string | undefined;
  session?(options: ConnectorOAuthSessionOptions): Promise<ConnectorBrowserSession>;
  warn?(message: string): void;
}

/** RFC 8252 listener belongs to the daemon's loopback interface. The UI receives
 * only a consent URL and safe status; no code, verifier or token crosses an RPC.
 * A browser on another machine cannot use this callback as its own localhost.
 */
export class ConnectorOAuthBroker {
  private readonly flows = new Map<string, Flow>();
  private readonly generations = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly completions = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private closed = false;
  constructor(private readonly ports: BrokerPorts) {}

  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.queues.set(id, result);
    void result
      .finally(() => {
        if (this.queues.get(id) === result) this.queues.delete(id);
      })
      .catch(() => undefined);
    return result;
  }

  begin(opened: Opened): Promise<{ authorizationUrl: string; callback: "host-loopback" }> {
    this.cancel(opened.entry.id);
    const attempt = randomUUID();
    this.generations.set(opened.entry.id, attempt);
    return this.serial(opened.entry.id, async () => {
      this.requireCurrent(opened.entry.id, attempt);
      if (!opened.bundle.oauth || opened.bundle.server.type === "stdio")
        throw new ConnectorError(
          "validation",
          "This connector is not configured for browser sign-in.",
        );
      const state = randomUUID();
      const server = createServer(
        { maxHeaderSize: 8192, requestTimeout: 30000, keepAliveTimeout: 5000 },
        (request, response) => this.callback(opened.entry.id, attempt, request, response),
      );
      server.maxHeadersCount = 32;
      const registration = opened.bundle.client
        ? undefined
        : getConnectorOAuthRegistration(opened.bundle);
      const port = await this.listenFor(server, opened, registration?.redirectUri);
      const callbackPath = registration
        ? new URL(registration.redirectUri).pathname
        : (this.ports.callbackPathFor?.(opened) ?? "/connectors/oauth/callback");
      if (this.closed || this.generations.get(opened.entry.id) !== attempt) {
        server.close();
        throw new ConnectorError("conflict", "This sign-in attempt was replaced.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        this.fail(opened.entry.id, attempt, "Sign-in timed out. Start again from Connectors.");
      }, 300000);
      timer.unref();
      const flow: Flow = {
        id: opened.entry.id,
        attempt,
        state,
        entry: opened.entry,
        server,
        controller,
        timer,
        session: null,
        accepted: false,
        callbackPath,
      };
      this.flows.set(flow.id, flow);
      server.on("error", () =>
        this.fail(flow.id, flow.attempt, "The host callback stopped. Start sign-in again."),
      );
      let redirect: string | null = null;
      try {
        flow.session = await (this.ports.session ?? McpOAuthSession.open)({
          store: this.ports.store,
          entry: opened.entry,
          bundle: opened.bundle,
          redirectUri: registration?.redirectUri ?? `http://127.0.0.1:${port}${callbackPath}`,
          state,
          interactive: true,
          active: () => !this.closed && this.generations.get(flow.id) === attempt,
          onRedirect: (url) => {
            redirect = url.toString();
          },
          fetcher: this.ports.fetcher,
          signal: controller.signal,
        });
        await flow.session.begin();
        this.requireCurrent(flow.id, attempt);
        if (!redirect)
          throw new ConnectorError("authorization", "The vendor did not return a sign-in address.");
        return { authorizationUrl: redirect, callback: "host-loopback" as const };
      } catch (error) {
        this.cancel(flow.id, attempt);
        throw error;
      }
    });
  }

  authorize(
    opened: Opened,
    signal: AbortSignal,
  ): Promise<{ server: ConnectorTransport; revision: string }> {
    signal = AbortSignal.any([signal, this.shutdown.signal]);
    return this.serial(opened.entry.id, async () => {
      signal.throwIfAborted();
      if (this.closed)
        throw new ConnectorError("unavailable", "Connector authorization is shutting down.");
      if (!opened.bundle.oauth)
        return { server: opened.bundle.server, revision: opened.entry.generation };
      if (opened.bundle.server.type === "stdio")
        throw new ConnectorError("validation", "Browser sign-in requires a remote connector.");
      const attempt = this.generations.get(opened.entry.id) ?? randomUUID();
      this.generations.set(opened.entry.id, attempt);
      const current = await this.ports.store.open(opened.entry.id);
      if (current.entry.generation !== opened.entry.generation)
        throw new ConnectorError("conflict", "The connector changed before authorization.");
      const server = current.bundle.server;
      if (server.type === "stdio")
        throw new ConnectorError("conflict", "This connector no longer uses browser sign-in.");
      const registration = current.bundle.client
        ? undefined
        : getConnectorOAuthRegistration(current.bundle);
      const stored = current.bundle.authorization?.client;
      const redirectUri =
        registration?.redirectUri ??
        (stored &&
        typeof stored === "object" &&
        "redirectUri" in stored &&
        typeof stored.redirectUri === "string"
          ? stored.redirectUri
          : "http://127.0.0.1:6871/connectors/oauth/callback");
      const session = await (this.ports.session ?? McpOAuthSession.open)({
        store: this.ports.store,
        entry: current.entry,
        bundle: current.bundle,
        redirectUri,
        state: "",
        interactive: false,
        active: () => !this.closed && this.generations.get(current.entry.id) === attempt,
        fetcher: this.ports.fetcher,
        signal,
      });
      const credential = await session.access();
      return {
        server: {
          ...server,
          headers: { ...server.headers, Authorization: credential.token },
        },
        revision: credential.revision,
      };
    });
  }

  private listen(server: Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off("listening", ready);
        server.off("error", failed);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const ready = () => {
        cleanup();
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Missing callback address"));
          return;
        }
        resolve(address.port);
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(port, "127.0.0.1");
    });
  }
  disconnect(id: string): Promise<void> {
    this.cancel(id);
    const attempt = this.generations.get(id);
    return this.serial(id, async () => {
      if (this.closed)
        throw new ConnectorError("unavailable", "Connector authorization is shutting down.");
      const opened = await this.ports.store.open(id);
      const session = await (this.ports.session ?? McpOAuthSession.open)({
        store: this.ports.store,
        entry: opened.entry,
        bundle: opened.bundle,
        redirectUri: "http://127.0.0.1:6871/connectors/oauth/callback",
        state: "",
        interactive: false,
        active: () => !this.closed && this.generations.get(id) === attempt,
        fetcher: this.ports.fetcher,
        signal: this.shutdown.signal,
      });
      await session.disconnect();
    });
  }
  async status(id: string): Promise<ReturnType<ConnectorBrowserSession["status"]>> {
    const opened = await this.ports.store.open(id);
    const session = await (this.ports.session ?? McpOAuthSession.open)({
      store: this.ports.store,
      entry: opened.entry,
      bundle: opened.bundle,
      redirectUri: "http://127.0.0.1:6871/connectors/oauth/callback",
      state: "",
      interactive: false,
      active: () => !this.closed,
      fetcher: this.ports.fetcher,
      signal: this.shutdown.signal,
    });
    return session.status();
  }
  private async listenFor(
    server: Server,
    opened: Opened,
    registeredRedirect: string | undefined,
  ): Promise<number> {
    const preferred = registeredRedirect
      ? Number(new URL(registeredRedirect).port)
      : (this.ports.callbackPortFor?.(opened) ?? this.ports.callbackPort ?? 6871);
    try {
      return await this.listen(server, preferred);
    } catch (error) {
      if (
        registeredRedirect ||
        opened.bundle.client ||
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "EADDRINUSE"
      )
        throw new ConnectorError(
          "unavailable",
          "The host sign-in callback port is unavailable. Finish the other sign-in or try again.",
        );
      return this.listen(server, 0);
    }
  }
  private callback(
    id: string,
    attempt: string,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const flow = this.flows.get(id);
    if (
      !flow ||
      flow.attempt !== attempt ||
      flow.accepted ||
      this.closed ||
      (request.url?.length ?? 0) > 8192
    ) {
      this.reply(response, 400, "This sign-in attempt is no longer active.");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      request.method !== "GET" ||
      url.pathname !== flow.callbackPath ||
      url.searchParams.get("state") !== flow.state ||
      !flow.session
    ) {
      this.reply(response, 400, "Invalid sign-in callback.");
      return;
    }
    flow.accepted = true;
    clearTimeout(flow.timer);
    flow.server.close(() => undefined);
    flow.server.closeIdleConnections();
    const code = url.searchParams.get("code");
    const completion = this.complete(flow, code, url.searchParams.has("error"), response);
    this.completions.add(completion);
    void completion
      .finally(() => {
        this.completions.delete(completion);
      })
      .catch(() => this.ports.warn?.("Connector sign-in completion could not be recorded."));
  }
  private async complete(
    flow: Flow,
    code: string | null,
    denied: boolean,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (denied || !code || !flow.session)
        throw new ConnectorError(
          "authorization",
          "Sign-in was declined or did not finish. Start again from Connectors.",
        );
      await flow.session.complete(code);
      this.requireCurrent(flow.id, flow.attempt);
      await this.ports.settled(
        flow.id,
        flow.entry.generation,
        { connected: true },
        () => !this.closed && this.generations.get(flow.id) === flow.attempt,
      );
      this.reply(response, 200, "Connected. Return to Otto.");
    } catch {
      if (!this.closed && this.generations.get(flow.id) === flow.attempt) {
        try {
          await this.ports.settled(
            flow.id,
            flow.entry.generation,
            {
              connected: false,
              message: "Sign-in did not finish. Reload Connectors before starting a new attempt.",
            },
            () => !this.closed && this.generations.get(flow.id) === flow.attempt,
          );
        } catch {
          this.ports.warn?.("Connector sign-in failure could not be recorded.");
        }
      }
      this.reply(response, 400, "Sign-in did not finish. Return to Otto to review the connection.");
    } finally {
      flow.controller.abort();
      if (this.flows.get(flow.id) === flow) this.flows.delete(flow.id);
      flow.server.close(() => undefined);
      flow.server.closeIdleConnections();
    }
  }
  private requireCurrent(id: string, attempt: string) {
    if (this.closed || this.generations.get(id) !== attempt)
      throw new ConnectorError("conflict", "This sign-in attempt is no longer active.");
  }
  private reply(response: ServerResponse, status: number, body: string) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'",
    });
    response.end(body);
  }
  private fail(id: string, attempt: string, message: string) {
    const flow = this.flows.get(id);
    if (!flow || flow.attempt !== attempt) return;
    this.cancel(id, attempt);
    const failedGeneration = this.generations.get(id);
    const completion = this.ports.settled(
      id,
      flow.entry.generation,
      { connected: false, message },
      () => !this.closed && this.generations.get(id) === failedGeneration,
    );
    this.completions.add(completion);
    void completion
      .finally(() => {
        this.completions.delete(completion);
      })
      .catch(() => this.ports.warn?.("Connector sign-in timeout could not be recorded."));
  }
  cancel(id: string, expectedAttempt?: string): void {
    const flow = this.flows.get(id);
    if (expectedAttempt && flow?.attempt !== expectedAttempt) return;
    this.generations.set(id, randomUUID());
    if (!flow) return;
    this.flows.delete(id);
    clearTimeout(flow.timer);
    flow.controller.abort();
    flow.server.close(() => undefined);
    flow.server.closeAllConnections();
  }
  isPending(id: string): boolean {
    return this.flows.has(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    const completions = [...this.completions];
    for (const id of this.flows.keys()) this.cancel(id);
    await Promise.allSettled(completions);
    await Promise.allSettled(this.queues.values());
  }
}
