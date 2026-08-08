import type { AudioEngine } from "@/voice/audio-engine-types";

const SAMPLE_RATE = 16_000;
const DURATION_MS = 120;

function createCuePcm(): Uint8Array {
  const samples = Math.round((SAMPLE_RATE * DURATION_MS) / 1000);
  const pcm = new Int16Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const frequency = index < samples / 2 ? 880 : 1320;
    const envelope = Math.min(1, index / 320, (samples - index) / 320);
    pcm[index] = Math.round(
      Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * 0x1800 * envelope,
    );
  }
  return new Uint8Array(pcm.buffer);
}

const CUE_PCM = createCuePcm();

/** Plays a short local acknowledgement before any dictation capture starts. */
export function playDictationStartCue(engine: AudioEngine | null): void {
  if (!engine) return;
  void engine
    .initialize()
    .then(() =>
      engine.play(
        {
          type: "audio/pcm;rate=16000;bits=16",
          size: CUE_PCM.byteLength,
          arrayBuffer: async () => CUE_PCM.slice().buffer,
        },
        { gain: 0.35 },
      ),
    )
    .catch(() => undefined);
}
