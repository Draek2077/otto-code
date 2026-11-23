/** A foreground owner can explicitly replace its listener without a daemon or process supervisor. */
import type { BrainConfig } from "../config/schema.js";
import type { ServiceHandle } from "./serve.js";
import { completeOwnedOperation } from "./owned-operation.js";

export type BrainServiceActivation =
  | { kind: "initial" }
  | { kind: "restart"; modelId: string | null };
export interface BrainServiceSessionPorts {
  readConfig(): BrainConfig;
  start(
    config: BrainConfig,
    restart: (modelId: string | null) => Promise<void>,
    activation: BrainServiceActivation,
  ): Promise<ServiceHandle>;
}

export class BrainServiceSession {
  private current: ServiceHandle | null = null;
  private transition: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private started = false;
  constructor(private readonly ports: BrainServiceSessionPorts) {}

  start(): Promise<void> {
    if (this.started || this.closed)
      return Promise.reject(new Error("Brain service session is already used"));
    this.started = true;
    return this.replace({ kind: "initial" });
  }
  restart(modelId: string | null): Promise<void> {
    if (!this.current || this.closed)
      return Promise.reject(new Error("Brain service session is not running"));
    if (this.transition)
      return Promise.reject(new Error("Brain service restart is already running"));
    return this.replace({ kind: "restart", modelId });
  }
  private replace(activation: BrainServiceActivation): Promise<void> {
    const replace = async () => {
      // Validate saved intent before stopping a working owner. No retries or default-file writes.
      const config = this.ports.readConfig();
      if (this.current) await this.current.stop();
      this.current = null;
      if (this.closed) return;
      this.current = await this.ports.start(config, (modelId) => this.restart(modelId), activation);
    };
    this.transition = replace().finally(() => {
      this.transition = null;
    });
    return this.transition;
  }
  stop(): Promise<void> {
    this.closed = true;
    // A late signal must not restart the listener after terminal shutdown. Even
    // a failed transition must release the still-running previous listener.
    return (this.closing ??= completeOwnedOperation(
      async () => {
        await this.transition;
      },
      async () => {
        const current = this.current;
        this.current = null;
        await current?.stop();
      },
    ));
  }
}
