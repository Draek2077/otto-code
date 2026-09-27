// What a hosted browser tab is costing this client right now, measured over a
// sliding window. The host's own counters arrive with each frame response; the
// stream measurement script in packages/server reports the same figures.

const WINDOW_MS = 10_000;

interface Sample {
  at: number;
  bytes: number;
  presentMs: number;
}

export interface StreamReading {
  framesPerSecond: number;
  kilobytesPerSecond: number;
  megabytesPerHour: number;
  /** Average time to decode and draw a frame. */
  presentMs: number;
}

export class StreamMeter {
  private samples: Sample[] = [];
  private startedAt: number | null = null;

  record(sample: Sample): void {
    this.startedAt ??= sample.at;
    this.samples.push(sample);
    this.trim(sample.at);
  }

  read(now: number): StreamReading {
    this.trim(now);
    // A window that has not filled yet is averaged over the time it covers.
    const covered = Math.min(WINDOW_MS, now - (this.startedAt ?? now));
    const seconds = Math.max(1, covered / 1_000);
    const bytes = this.samples.reduce((sum, sample) => sum + sample.bytes, 0);
    const present = this.samples.reduce((sum, sample) => sum + sample.presentMs, 0);
    const kilobytesPerSecond = bytes / 1_024 / seconds;
    return {
      framesPerSecond: this.samples.length / seconds,
      kilobytesPerSecond,
      megabytesPerHour: (kilobytesPerSecond * 3_600) / 1_024,
      presentMs: this.samples.length ? present / this.samples.length : 0,
    };
  }

  private trim(now: number): void {
    const oldest = now - WINDOW_MS;
    while (this.samples.length && this.samples[0]!.at < oldest) this.samples.shift();
  }
}

export function formatStreamReading(reading: StreamReading): string {
  return [
    `${reading.framesPerSecond.toFixed(1)} fps`,
    `${Math.round(reading.kilobytesPerSecond)} KB/s`,
    `${Math.round(reading.megabytesPerHour)} MB/h`,
    `${Math.round(reading.presentMs)} ms`,
  ].join(" · ");
}
