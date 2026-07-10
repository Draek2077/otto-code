import { describe, expect, it } from "vitest";
import { resamplePcm16 } from "@/voice/resample-pcm16";

function encodePcm16(samples: number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    out[i * 2] = clamped & 0xff;
    out[i * 2 + 1] = (clamped >> 8) & 0xff;
  }
  return out;
}

function decodePcm16(pcm: Uint8Array): number[] {
  const samples: number[] = [];
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    let value = (pcm[i + 1] << 8) | pcm[i];
    if (value & 0x8000) {
      value = value - 0x10000;
    }
    samples.push(value);
  }
  return samples;
}

function makeSine(frequencyHz: number, sampleRateHz: number, amplitude: number, count: number) {
  const samples: number[] = [];
  for (let n = 0; n < count; n++) {
    samples.push(amplitude * Math.sin((2 * Math.PI * frequencyHz * n) / sampleRateHz));
  }
  return samples;
}

/** Amplitude of a single frequency via DFT correlation over a bin-aligned window. */
function toneAmplitude(samples: number[], frequencyHz: number, sampleRateHz: number): number {
  // Skip edges so FIR boundary transients and interpolation warm-up don't leak in.
  const skip = 256;
  const available = samples.length - 2 * skip;
  // Keep the window a whole number of cycles so a rectangular window is leak-free.
  const samplesPerCycle = sampleRateHz / frequencyHz;
  const cycles = Math.floor(available / samplesPerCycle);
  const window = Math.round(cycles * samplesPerCycle);
  let re = 0;
  let im = 0;
  for (let n = 0; n < window; n++) {
    const phase = (2 * Math.PI * frequencyHz * n) / sampleRateHz;
    const value = samples[skip + n];
    re += value * Math.cos(phase);
    im -= value * Math.sin(phase);
  }
  return (2 * Math.sqrt(re * re + im * im)) / window;
}

/** The pre-fix resampler: linear interpolation with no anti-aliasing filter. */
function naiveLinearResample(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  const input = decodePcm16(pcm);
  const outputSamples = Math.floor((input.length * toRate) / fromRate);
  const ratio = fromRate / toRate;
  const out: number[] = [];
  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const s0 = input[i0] ?? 0;
    const s1 = input[Math.min(input.length - 1, i0 + 1)] ?? 0;
    out.push(s0 + (s1 - s0) * frac);
  }
  return encodePcm16(out);
}

describe("resamplePcm16", () => {
  it("returns the input untouched when rates match", () => {
    const pcm = encodePcm16(makeSine(1000, 16000, 8000, 160));
    expect(resamplePcm16(pcm, 16000, 16000)).toBe(pcm);
  });

  it("produces the expected output length for 24kHz -> 16kHz", () => {
    const pcm = encodePcm16(makeSine(1000, 24000, 8000, 2400));
    const out = resamplePcm16(pcm, 24000, 16000);
    expect(out.length).toBe(Math.floor((2400 * 16000) / 24000) * 2);
  });

  it("attenuates aliased content by >30dB versus naive linear interpolation", () => {
    // 10kHz is above the 8kHz target Nyquist; after 24k -> 16k decimation it
    // aliases to 16000 - 10000 = 6000Hz unless filtered out first.
    const inputRate = 24000;
    const outputRate = 16000;
    const toneHz = 10000;
    const aliasHz = outputRate - toneHz;
    const amplitude = 16000;
    const pcm = encodePcm16(makeSine(toneHz, inputRate, amplitude, inputRate / 2));

    const naive = decodePcm16(naiveLinearResample(pcm, inputRate, outputRate));
    const filtered = decodePcm16(resamplePcm16(pcm, inputRate, outputRate));

    const naiveAliasAmp = toneAmplitude(naive, aliasHz, outputRate);
    const filteredAliasAmp = toneAmplitude(filtered, aliasHz, outputRate);

    // Sanity: the naive resampler really does leak a strong alias.
    expect(naiveAliasAmp).toBeGreaterThan(amplitude / 10);

    const attenuationDb = 20 * Math.log10(filteredAliasAmp / naiveAliasAmp);
    expect(attenuationDb).toBeLessThan(-30);
  });

  it("passes in-band speech content through at roughly unity gain", () => {
    const inputRate = 24000;
    const outputRate = 16000;
    const toneHz = 1000;
    const amplitude = 16000;
    const pcm = encodePcm16(makeSine(toneHz, inputRate, amplitude, inputRate / 2));

    const filtered = decodePcm16(resamplePcm16(pcm, inputRate, outputRate));
    const outputAmp = toneAmplitude(filtered, toneHz, outputRate);

    const gainDb = 20 * Math.log10(outputAmp / amplitude);
    expect(Math.abs(gainDb)).toBeLessThan(1);
  });
});
