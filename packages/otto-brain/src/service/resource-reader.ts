/** Optional hardware reads share one probe; cheap status never requests one. */
import type { GpuInfo } from "../types.js";
export interface BrainHostResources {
  cpu: number | null;
  cpuCount: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  gpu: GpuInfo | null;
}
interface ResourceWaiter<T> {
  finish(value: T | null, error: Error | null): void;
}
interface ResourceFlight<T> {
  controller: AbortController;
  readers: Set<ResourceWaiter<T>>;
  done: Promise<void>;
}

export class BrainResourceReader<T> {
  private flight: ResourceFlight<T> | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;
  constructor(private readonly sample: (signal: AbortSignal) => Promise<T>) {}

  async read(signal: AbortSignal): Promise<T> {
    if (this.closed) throw new Error("Brain resource reader is closed");
    signal.throwIfAborted();
    if (this.flight?.controller.signal.aborted)
      throw new Error("The previous Brain resource probe is stopping");
    const flight = this.flight ?? this.start();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const waiter: ResourceWaiter<T> = {
        finish: (value, error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", aborted);
          flight.readers.delete(waiter);
          if (flight.readers.size === 0) flight.controller.abort();
          if (error) reject(error);
          else if (value !== null) resolve(value);
          else reject(new Error("Brain resources are unavailable"));
        },
      };
      const aborted = () => waiter.finish(null, new Error("Brain resource read canceled"));
      flight.readers.add(waiter);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }

  close(): Promise<void> {
    if (this.closed) return this.closing ?? Promise.resolve();
    this.closed = true;
    this.closing = this.flight?.done ?? Promise.resolve();
    if (this.flight) {
      this.flight.controller.abort();
      this.complete(this.flight, null, new Error("Brain resource reader is closed"));
    }
    return this.closing;
  }

  private start(): ResourceFlight<T> {
    const flight: ResourceFlight<T> = {
      controller: new AbortController(),
      readers: new Set(),
      done: Promise.resolve(),
    };
    this.flight = flight;
    flight.done = Promise.resolve()
      .then(async () => {
        if (flight.controller.signal.aborted)
          return this.complete(flight, null, new Error("Brain resource read canceled"));
        const value = await this.sample(flight.controller.signal);
        return this.complete(flight, value, null);
      })
      .catch(() => this.complete(flight, null, new Error("Brain resources are unavailable")));
    return flight;
  }

  private complete(flight: ResourceFlight<T>, value: T | null, error: Error | null): void {
    if (this.flight !== flight) return;
    this.flight = null;
    for (const reader of flight.readers) reader.finish(value, error);
  }
}
