/**
 * Sample-rate conversion for little-endian PCM16 audio (TTS playback resampling).
 *
 * Downsampling folds any content above the target Nyquist back into the audible
 * band (e.g. 24kHz -> 16kHz aliases 8-12kHz content into 4-8kHz, which sounds
 * metallic), so a windowed-sinc low-pass runs before the linear interpolation.
 * Each call is self-contained: edges are handled by replicating the boundary
 * sample rather than carrying filter state, so streamed ~50ms chunks stay
 * click-free without a stateful resampler.
 */

// Odd tap count keeps the kernel symmetric (linear phase, integer group delay).
// 63 taps with a Blackman window gives a ~2.1kHz transition band at 24kHz input,
// well over 30dB attenuation for anything that would alias audibly.
const FIR_TAPS = 63;

// Cutoff as a fraction of the target rate: 0.45 puts it at 7.2kHz for a 16kHz
// target, leaving headroom below the 8kHz Nyquist for the filter roll-off.
const CUTOFF_RATIO = 0.45;

const kernelCache = new Map<number, Float32Array>();

function getLowPassKernel(cutoffHz: number, sampleRateHz: number): Float32Array {
  const normalizedCutoff = cutoffHz / sampleRateHz;
  const cached = kernelCache.get(normalizedCutoff);
  if (cached) {
    return cached;
  }

  const kernel = new Float32Array(FIR_TAPS);
  const mid = (FIR_TAPS - 1) / 2;
  let sum = 0;
  for (let n = 0; n < FIR_TAPS; n++) {
    const x = n - mid;
    const sinc =
      x === 0 ? 2 * normalizedCutoff : Math.sin(2 * Math.PI * normalizedCutoff * x) / (Math.PI * x);
    const window =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / (FIR_TAPS - 1)) +
      0.08 * Math.cos((4 * Math.PI * n) / (FIR_TAPS - 1));
    kernel[n] = sinc * window;
    sum += kernel[n];
  }
  // Normalize to unity DC gain so filtered speech keeps its level.
  for (let n = 0; n < FIR_TAPS; n++) {
    kernel[n] /= sum;
  }

  kernelCache.set(normalizedCutoff, kernel);
  return kernel;
}

function lowPassFilter(samples: Float32Array, kernel: Float32Array): Float32Array {
  const length = samples.length;
  const half = (kernel.length - 1) / 2;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      let j = i + k - half;
      if (j < 0) {
        j = 0;
      } else if (j >= length) {
        j = length - 1;
      }
      acc += samples[j] * kernel[k];
    }
    out[i] = acc;
  }
  return out;
}

export function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate) {
    return pcm;
  }

  const inputSamples = Math.floor(pcm.length / 2);
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const out = new Uint8Array(outputSamples * 2);
  if (inputSamples === 0 || outputSamples === 0) {
    return out;
  }

  const samples = new Float32Array(inputSamples);
  for (let i = 0; i < inputSamples; i++) {
    const lo = pcm[i * 2];
    const hi = pcm[i * 2 + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value = value - 0x10000;
    }
    samples[i] = value;
  }

  const source =
    toRate < fromRate
      ? lowPassFilter(samples, getLowPassKernel(CUTOFF_RATIO * toRate, fromRate))
      : samples;

  const ratio = fromRate / toRate;
  const lastIndex = inputSamples - 1;
  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const i0 = Math.min(lastIndex, Math.floor(srcPos));
    const i1 = Math.min(lastIndex, i0 + 1);
    const frac = srcPos - i0;
    const value = source[i0] + (source[i1] - source[i0]) * frac;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(value)));
    out[i * 2] = clamped & 0xff;
    out[i * 2 + 1] = (clamped >> 8) & 0xff;
  }

  return out;
}
