import { describe, expect, it } from "vitest";

import { hasPcm16VoiceActivity } from "./wake-word-audio";

function pcm16(amplitudes: number[]): Uint8Array {
  const output = new Uint8Array(amplitudes.length * 2);
  amplitudes.forEach((amplitude, index) => {
    const value = Math.max(-32768, Math.min(32767, Math.round(amplitude * 32768)));
    output[index * 2] = value & 0xff;
    output[index * 2 + 1] = (value >> 8) & 0xff;
  });
  return output;
}

describe("hasPcm16VoiceActivity", () => {
  it("rejects silence and a low room-noise floor", () => {
    expect(hasPcm16VoiceActivity(new Uint8Array())).toBe(false);
    expect(hasPcm16VoiceActivity(pcm16(Array.from({ length: 160 }, () => 0.003)))).toBe(false);
  });

  it("recognizes command speech in the wake handoff", () => {
    const samples = Array.from({ length: 160 }, (_, index) => (index % 2 === 0 ? 0.08 : -0.08));
    expect(hasPcm16VoiceActivity(pcm16(samples))).toBe(true);
  });
});
