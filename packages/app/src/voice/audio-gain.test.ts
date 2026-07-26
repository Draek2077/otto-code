import { describe, expect, it } from "vitest";
import { applyPcm16Gain, clampGain } from "./audio-gain";

function pcm16(...samples: number[]): Uint8Array {
  const view = new Int16Array(samples);
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function samplesOf(bytes: Uint8Array): number[] {
  const copy = new Uint8Array(bytes);
  return [...new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2))];
}

describe("clampGain", () => {
  it("passes a valid level through", () => {
    expect(clampGain(0.5)).toBe(0.5);
    expect(clampGain(0)).toBe(0);
    expect(clampGain(1)).toBe(1);
  });

  it("clamps out-of-range levels", () => {
    expect(clampGain(4)).toBe(1);
    expect(clampGain(-2)).toBe(0);
  });

  // An absent `gain` option must mean "as loud as it was before the option
  // existed", not silence.
  it("treats missing or unusable input as full volume", () => {
    expect(clampGain(undefined)).toBe(1);
    expect(clampGain(Number.NaN)).toBe(1);
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("applyPcm16Gain", () => {
  it("scales samples by a linear amplitude", () => {
    expect(samplesOf(applyPcm16Gain(pcm16(1000, -2000, 4), 0.5))).toEqual([500, -1000, 2]);
  });

  it("returns the input untouched at full gain", () => {
    const input = pcm16(1000, -2000);
    expect(applyPcm16Gain(input, 1)).toBe(input);
  });

  it("silences at zero without shortening the clip", () => {
    const out = applyPcm16Gain(pcm16(1000, -2000, 32767), 0);
    expect(samplesOf(out)).toEqual([0, 0, 0]);
    expect(out.byteLength).toBe(6);
  });

  // The caller's buffer is often a shared decode result — scaling must not
  // reach back into it.
  it("does not mutate the caller's buffer", () => {
    const input = pcm16(1000, -2000);
    applyPcm16Gain(input, 0.25);
    expect(samplesOf(input)).toEqual([1000, -2000]);
  });

  // Rounding must not wrap a near-full-scale sample to the opposite sign.
  it("keeps scaled samples inside the Int16 range", () => {
    expect(samplesOf(applyPcm16Gain(pcm16(32767, -32768), 0.999999))).toEqual([32767, -32768]);
  });

  // Views handed in by the resampler can start at a non-zero byte offset; the
  // Int16 view built inside must not inherit an unaligned offset.
  it("handles a byte view that starts at an odd offset", () => {
    const backing = new Uint8Array(5);
    backing.set([0xff, 0xe8, 0x03, 0x18, 0xfc]);
    const unaligned = backing.subarray(1); // 1000, -1000 as PCM16LE
    expect(samplesOf(applyPcm16Gain(unaligned, 0.5))).toEqual([500, -500]);
  });
});
