/** Saved startup intent is applied only at the owning Otto daemon's explicit startup boundary. */
export interface BrainStartupPorts {
  connection(): { enabled: boolean; autoStart: boolean; mode: "local" | "remote" };
  isRunning(): boolean;
  start(signal?: AbortSignal): Promise<void>;
}
export type BrainStartupResult = "skipped" | "already-running" | "started";

export class BrainStartup {
  private applied: Promise<BrainStartupResult> | null = null;
  constructor(private readonly ports: BrainStartupPorts) {}

  /** Once per daemon lifetime, including failure. Settings saves never call this,
   * and an uncertain startup is never retried or converted into a restart. */
  apply(signal?: AbortSignal): Promise<BrainStartupResult> {
    return (this.applied ??= Promise.resolve().then(() => this.run(signal)));
  }
  private async run(signal?: AbortSignal): Promise<BrainStartupResult> {
    signal?.throwIfAborted();
    const intent = this.ports.connection();
    if (!intent.enabled || !intent.autoStart || intent.mode !== "local") return "skipped";
    if (this.ports.isRunning()) return "already-running";
    signal?.throwIfAborted();
    await this.ports.start(signal);
    return "started";
  }
}
