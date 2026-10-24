/** One selected owner per daemon; the app never opens a Brain HTTP connection. */
import { randomUUID } from "node:crypto";
import { BrainConnectionStore, BrainConnectionError } from "./connection-store.js";
import { BrainStatusStore, type BrainStatusSource } from "../client/status-store.js";
import { brainStatusSource } from "../client/status-source.js";
import type { BrainHostEvent } from "../service/event-decoder.js";
import { localBrainClient } from "../service/local-client.js";
import { remoteBrainClient } from "../service/remote-client.js";
import { startLocalBrain, stopLocalBrain } from "../service/lifecycle.js";
import { readPidFile, isProcessAlive } from "../service/pid-lock.js";
import { readBrainConfig } from "../config/store.js";
import { restartRemoteBrain } from "./remote-restart.js";

export interface BrainControllerTransport {
  request(route: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  events(receive: (event: BrainHostEvent) => void, signal: AbortSignal): Promise<void>;
}
export interface BrainControllerPorts {
  localClient(): BrainControllerTransport;
  remoteClient(options: Parameters<typeof remoteBrainClient>[0]): BrainControllerTransport;
  defaultModel(): string | null;
  start(modelId: string | null, signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

export class BrainController<Status extends { instanceId: string }> {
  readonly status: BrainStatusStore<Status>;
  private closed = false;
  private readonly lifetime = new AbortController();
  private transportLifetime = new AbortController();
  private lifecycle: Promise<void> | null = null;
  private connectionSnapshot: ReturnType<BrainConnectionStore["read"]> | null = null;
  constructor(
    readonly connection: BrainConnectionStore,
    private readonly ports: BrainControllerPorts,
    decodeStatus: (value: unknown) => Status,
  ) {
    const source: BrainStatusSource<Status> = {
      open: async (receive, signal) => {
        const intent = this.connection.resolve();
        if (!intent.enabled) return waitForAbort(signal);
        return brainStatusSource(this.client(), decodeStatus).open(receive, signal);
      },
    };
    this.status = new BrainStatusStore(source, { streamId: randomUUID() });
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("Brain controller is closed");
  }
  private client(): BrainControllerTransport {
    this.assertOpen();
    const intent = this.connection.resolve();
    return intent.mode === "remote"
      ? this.ports.remoteClient(intent.remote)
      : this.ports.localClient();
  }
  readConnection() {
    this.assertOpen();
    const next = this.connection.read();
    const changed =
      this.connectionSnapshot !== null && this.connectionSnapshot.revision !== next.revision;
    this.connectionSnapshot = next;
    if (changed) {
      this.invalidateRequests();
      this.status.invalidate();
    }
    return next;
  }
  peekConnection() {
    this.assertOpen();
    return this.connectionSnapshot ?? this.readConnection();
  }
  saveConnection(input: unknown) {
    this.assertOpen();
    if (this.lifecycle)
      throw new BrainConnectionError(
        "validation",
        "Wait for the current Brain lifecycle operation before changing its connection",
      );
    const saved = this.connection.save(input);
    this.connectionSnapshot = saved;
    this.invalidateRequests();
    this.status.invalidate();
    return saved;
  }
  /** Callers expose typed operations, never an arbitrary HTTP proxy to the browser. */
  request(route: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const signals = [this.lifetime.signal, this.transportLifetime.signal];
    if (signal) signals.push(signal);
    const lifetime = AbortSignal.any(signals);
    return this.client().request(route, body, lifetime);
  }
  private invalidateRequests(): void {
    this.transportLifetime.abort();
    this.transportLifetime = new AbortController();
  }
  performLifecycleAction(
    action: "start" | "stop" | "restart",
    modelId: string | null = null,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOpen();
    if (this.connection.resolve().mode === "local")
      return this.performLocalAction(action, modelId, signal);
    if (action !== "restart")
      return Promise.reject(
        new BrainConnectionError(
          "validation",
          "Start or stop the Remote Brain service on its owning host",
        ),
      );
    if (!this.connection.resolve().enabled)
      return Promise.reject(
        new BrainConnectionError(
          "validation",
          "Enable Brain in Otto's host settings before restarting it",
        ),
      );
    if (this.lifecycle)
      return Promise.reject(
        new BrainConnectionError(
          "unavailable",
          "Another Brain lifecycle operation is still running",
        ),
      );
    const signals = [this.lifetime.signal, this.transportLifetime.signal];
    if (signal) signals.push(signal);
    this.lifecycle = restartRemoteBrain(this.client(), modelId, AbortSignal.any(signals)).finally(
      () => {
        this.lifecycle = null;
        if (!this.closed) this.status.invalidate();
      },
    );
    return this.lifecycle;
  }
  performLocalAction(
    action: "start" | "stop" | "restart",
    modelId: string | null = null,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOpen();
    if (this.connection.resolve().mode !== "local")
      return Promise.reject(
        new BrainConnectionError(
          "validation",
          "Control the Remote Brain lifecycle on its owning host",
        ),
      );
    if (action !== "stop" && !this.connection.resolve().enabled)
      return Promise.reject(
        new BrainConnectionError(
          "validation",
          "Enable Brain in Otto's host settings before starting it",
        ),
      );
    if (this.lifecycle)
      return Promise.reject(
        new BrainConnectionError(
          "unavailable",
          "Another Brain lifecycle operation is still running",
        ),
      );
    const operationSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    const run = async () => {
      operationSignal.throwIfAborted();
      if (action !== "start") await this.ports.stop(operationSignal);
      operationSignal.throwIfAborted();
      if (action !== "stop")
        await this.ports.start(modelId ?? this.ports.defaultModel(), operationSignal);
    };
    this.lifecycle = run().finally(() => {
      this.lifecycle = null;
      if (!this.closed) this.status.invalidate();
    });
    return this.lifecycle;
  }
  /** Closing UI/daemon demand never stops an independently owned host or its jobs. */
  async close(): Promise<void> {
    this.closed = true;
    this.lifetime.abort();
    await this.status.close();
  }
}

/** Explicit composition receives the daemon's home; no process-global environment mutation. */
export function createBrainController<Status extends { instanceId: string }>(input: {
  connectionFile: string;
  env: NodeJS.ProcessEnv;
  decodeStatus(value: unknown): Status;
}) {
  const env = { ...input.env };
  return new BrainController(
    new BrainConnectionStore(input.connectionFile),
    {
      localClient() {
        // A passive read must not remove a stale ownership record.
        const record = readPidFile(env);
        if (!record || !isProcessAlive(record.pid))
          throw new BrainConnectionError(
            "unavailable",
            "Start the local Brain host to use its runtime and models",
          );
        return localBrainClient({ record, env, config: readBrainConfig(env) });
      },
      remoteClient: remoteBrainClient,
      defaultModel: () => readBrainConfig(env).defaultModel,
      start: async (model, signal) => {
        await startLocalBrain({ env, signal, ...(model ? { model } : {}) });
      },
      stop: async (signal) => {
        await stopLocalBrain(env, signal);
      },
    },
    input.decodeStatus,
  );
}
