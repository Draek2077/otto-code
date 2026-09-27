import { describe, expect, it } from "vitest";
import { formatStreamReading, StreamMeter } from "./hosted-stream-meter";

describe("hosted stream meter", () => {
  it("reports nothing moving for a tab that received no frames", () => {
    expect(new StreamMeter().read(5_000)).toEqual({
      framesPerSecond: 0,
      kilobytesPerSecond: 0,
      megabytesPerHour: 0,
      presentMs: 0,
    });
  });

  it("averages frames and bytes over the time the window covers", () => {
    const meter = new StreamMeter();
    for (let second = 0; second < 5; second++)
      meter.record({ at: second * 1_000, bytes: 10_240, presentMs: 8 });

    const reading = meter.read(5_000);
    expect(reading.framesPerSecond).toBe(1);
    expect(reading.kilobytesPerSecond).toBe(10);
    expect(reading.megabytesPerHour).toBeCloseTo(35.16, 2);
    expect(reading.presentMs).toBe(8);
  });

  it("forgets frames older than the window so a page that went still reads as still", () => {
    const meter = new StreamMeter();
    meter.record({ at: 0, bytes: 50_000, presentMs: 5 });
    meter.record({ at: 1_000, bytes: 50_000, presentMs: 5 });

    expect(meter.read(30_000).kilobytesPerSecond).toBe(0);
  });

  it("formats a reading as one compact line", () => {
    expect(
      formatStreamReading({
        framesPerSecond: 3.72,
        kilobytesPerSecond: 22.4,
        megabytesPerHour: 78.7,
        presentMs: 7.6,
      }),
    ).toBe("3.7 fps · 22 KB/s · 79 MB/h · 8 ms");
  });
});
