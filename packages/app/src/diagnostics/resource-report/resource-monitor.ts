// The always-on resource monitor.
//
// Runs from app start so that by the time an FPS complaint happens the history
// already exists - a leak you have to reproduce on demand is a leak you never
// find. Two loops, deliberately different:
//
//  - a `requestAnimationFrame` chain that only times frames (the symptom), and
//  - a census interval that counts retained state (the cause).
//
// Both are bounded: the ring buffer has a fixed capacity, so the instrument
// cannot itself become the leak it is looking for.

import { isWeb } from "@/constants/platform";
import { collectResourceMetrics } from "./collect-resource-metrics";
import { FrameRateSampler, type FrameWindowStats } from "./frame-rate-sampler";
import { startLongFrameAttribution, stopLongFrameAttribution } from "./long-frame-attribution";
import { installRuntimeCounters } from "./runtime-counters";
import type { ResourceSample } from "./resource-trend";

export interface ResourceMonitorOptions {
  /** How often to take a census. */
  intervalMs?: number;
  /** Ring-buffer capacity. intervalMs * capacity is the observable history. */
  capacity?: number;
  /** Time frames as well as counting state. Web/Electron only. */
  sampleFrames?: boolean;
}

export const DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS = 10_000;
// 10s * 2160 = 6 hours of history at roughly 0.5 MB.
export const DEFAULT_RESOURCE_SAMPLE_CAPACITY = 2160;

type Listener = (sample: ResourceSample) => void;

class ResourceMonitor {
  private samples: ResourceSample[] = [];
  private capacity = DEFAULT_RESOURCE_SAMPLE_CAPACITY;
  private intervalMs = DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameHandle: number | null = null;
  private frameSampler: FrameRateSampler | null = null;
  private startedAtMs = 0;
  private readonly listeners = new Set<Listener>();

  get running(): boolean {
    return this.timer !== null;
  }

  get startedAt(): number {
    return this.startedAtMs;
  }

  start(options: ResourceMonitorOptions = {}): void {
    if (this.timer !== null) {
      return;
    }
    // Patch before anything else schedules work, or the live-interval count
    // starts from an unknown baseline.
    installRuntimeCounters();

    this.intervalMs = options.intervalMs ?? DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS;
    this.capacity = options.capacity ?? DEFAULT_RESOURCE_SAMPLE_CAPACITY;
    this.startedAtMs = Date.now();

    // rAF is web-only here on purpose: on native a permanently scheduled frame
    // callback keeps the JS thread from idling, which costs battery to measure a
    // symptom that was reported on desktop.
    const shouldSampleFrames = options.sampleFrames ?? isWeb;
    if (shouldSampleFrames && typeof requestAnimationFrame === "function") {
      this.frameSampler = new FrameRateSampler();
      this.scheduleFrame();
      // Same gate as the sampler: the sampler counts the long frames, the
      // attribution names the scripts inside them. No-op where LoAF is absent.
      startLongFrameAttribution();
    }

    this.timer = setInterval(() => {
      this.takeSample();
    }, this.intervalMs);
    // Baseline sample, so a short session still produces a usable series.
    this.takeSample();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.frameHandle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
    this.frameSampler = null;
    stopLongFrameAttribution();
  }

  reset(): void {
    this.samples = [];
    this.startedAtMs = Date.now();
    this.frameSampler?.flush();
  }

  getSamples(): readonly ResourceSample[] {
    return this.samples;
  }

  getLatest(): ResourceSample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  getSampleIntervalMs(): number {
    return this.intervalMs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Take a census now, outside the interval - used by the report UI's refresh. */
  takeSample(): ResourceSample | null {
    let frames: FrameWindowStats | null = null;
    try {
      frames = this.frameSampler?.flush() ?? null;
      const sample: ResourceSample = {
        at: Date.now(),
        uptimeMs: Date.now() - this.startedAtMs,
        metrics: collectResourceMetrics(frames),
      };
      this.samples.push(sample);
      if (this.samples.length > this.capacity) {
        this.samples.splice(0, this.samples.length - this.capacity);
      }
      for (const listener of this.listeners) {
        listener(sample);
      }
      return sample;
    } catch {
      // Never let the instrument break the app it is measuring.
      return null;
    }
  }

  private scheduleFrame(): void {
    this.frameHandle = requestAnimationFrame((timestamp) => {
      this.frameSampler?.recordFrame(timestamp);
      if (this.frameSampler) {
        this.scheduleFrame();
      }
    });
  }
}

export const resourceMonitor = new ResourceMonitor();
