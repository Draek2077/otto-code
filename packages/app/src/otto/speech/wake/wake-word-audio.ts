const PCM16_MAX = 0x8000;
const COMMAND_RMS_THRESHOLD = 0.01;
const COMMAND_PEAK_THRESHOLD = 0.04;

/** Distinguish command speech in the post-wake handoff from the room floor. */
export function hasPcm16VoiceActivity(pcm: Uint8Array): boolean {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount === 0) return false;

  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 2;
    let value = pcm[offset] | (pcm[offset + 1] << 8);
    if (value & 0x8000) value -= 0x10000;
    const sample = value / PCM16_MAX;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms >= COMMAND_RMS_THRESHOLD && peak >= COMMAND_PEAK_THRESHOLD;
}
