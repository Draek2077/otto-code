/** Lazy native ownership: an empty Brain host needs neither a runtime nor a port. */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { Profile } from "../config/schema.js";
import type { Model, GpuInfo } from "../types.js";
import type { FitResult } from "../vram.js";
import type { Supervisor } from "./supervisor.js";

export class EngineProcess extends EventEmitter {
  residentId = randomUUID();
  model: Model | null = null;
  profile: Profile | null = null;
  profileRevision: string | null = null;
  fit: FitResult | null = null;
  gpu: GpuInfo | null = null;
  private child: Supervisor | null = null;
  private phase = "stopped";
  private loading: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private verbosity = 3;

  constructor(private readonly create: () => Promise<Supervisor>) {
    super();
  }

  get state(): string {
    return this.child?.state ?? this.phase;
  }
  get host(): "127.0.0.1" {
    return "127.0.0.1";
  }
  get internalPort(): number {
    return this.child?.internalPort ?? 0;
  }
  get upstream(): string {
    return this.child?.upstream ?? "";
  }
  get logVerbosity(): number {
    return this.verbosity;
  }
  set logVerbosity(value: number) {
    this.verbosity = value;
    if (this.child) this.child.logVerbosity = value;
  }
  get allocationLogLines(): string[] {
    return this.child?.allocationLogLines ?? [];
  }
  get vramAtReadyBytes(): number | null {
    return this.child?.vramAtReadyBytes ?? null;
  }
  get vramBaselineBytes(): number | null {
    return this.child?.vramBaselineBytes ?? null;
  }
  get loadSeconds(): number | null {
    return this.child?.loadSeconds ?? null;
  }
  get startedAt(): Date | null {
    return this.child?.startedAt ?? null;
  }
  get args(): string[] | null {
    return this.child?.args ?? null;
  }
  get runtime() {
    return this.child?.runtime ?? null;
  }

  start(model: Model, profile: Profile, signal?: AbortSignal): Promise<void> {
    if (
      this.pending ||
      (this.child && this.child.state !== "stopped" && this.child.state !== "failed")
    )
      return Promise.reject(new Error("Brain model process is already owned"));
    const controller = new AbortController();
    this.loading = controller;
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.model = model;
    this.profile = profile;
    this.phase = "starting";
    this.emit("state");
    const pending = this.launch(model, profile, combined).finally(() => {
      if (this.pending === pending) this.pending = null;
      if (this.loading === controller) this.loading = null;
    });
    this.pending = pending;
    return pending;
  }

  private async launch(model: Model, profile: Profile, signal: AbortSignal): Promise<void> {
    try {
      const prior = this.child;
      prior?.removeAllListeners();
      this.child = null;
      await prior?.stop();
      signal.throwIfAborted();
      // Resolve the selected runtime on each explicit launch, including after an update.
      const next = await this.create();
      signal.throwIfAborted();
      this.child = next;
      next.logVerbosity = this.verbosity;
      this.residentId = randomUUID();
      next.on("state", () => this.emit("state"));
      next.on("crashed", () => this.emit("state"));
      next.on("log", (line: string) => this.emit("log", line));
      await next.start(model, profile, signal);
      this.profile = next.profile;
    } catch (error) {
      this.phase = signal.aborted ? "stopped" : "failed";
      this.emit("state");
      throw error;
    }
  }

  async stop(signal?: AbortSignal): Promise<void> {
    this.loading?.abort(new Error("Brain model stopped"));
    await this.child?.stop(signal);
    // A port/runtime resolution already in flight cannot launch after stop resolves.
    await this.pending?.catch(() => undefined);
    this.phase = "stopped";
    this.emit("state");
  }
}

/** The supervisor rechecks this port before launch; occupied ports fail closed. */
export async function allocateEnginePort(): Promise<number> {
  const probe = net.createServer();
  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No Brain engine port"));
        else resolve(address.port);
      });
    });
  });
}
