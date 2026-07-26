// Linear-amplitude helpers shared by both audio-engine implementations.
//
// The engine takes a per-play `gain` rather than carrying one master volume,
// because playback is not one channel: assistant speech (voice mode,
// auto-speech, the per-message play button) and agent voice cues share the same
// engine but have their own sliders, and a level that suits one rarely suits the
// other. Whoever calls `play()` knows which channel it is speaking on, so the
// gain rides with the call.

/** Coerce anything into a usable 0..1 linear amplitude; garbage means full. */
export function clampGain(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Scale signed 16-bit little-endian PCM by `gain`, returning a new buffer.
 *
 * Only the native engine needs this: `expo-two-way-audio` has no volume control
 * of its own, so the samples themselves have to carry the level. The web engine
 * uses a real GainNode instead. `gain >= 1` is a no-op and returns the input
 * untouched.
 */
export function applyPcm16Gain(bytes: Uint8Array, gain: number): Uint8Array {
  if (gain >= 1) {
    return bytes;
  }
  // Copy into a fresh buffer so the Int16 view starts at offset 0 — a
  // subarray's byteOffset is not guaranteed to be 2-aligned, and the caller's
  // buffer is not ours to mutate.
  const out = new Uint8Array(bytes);
  const sampleCount = Math.floor(out.byteLength / 2);
  const samples = new Int16Array(out.buffer, 0, sampleCount);
  if (gain <= 0) {
    samples.fill(0);
    return out;
  }
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain)));
  }
  return out;
}
