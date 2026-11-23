import type { SpeechStreamResult } from "../../speech/speech-provider.js";
import { parsePcmRateFromFormat } from "../../speech/audio.js";

export const MAX_SPEECH_AUDIO_BYTES = 8 * 1024 * 1024;

export function speechWav(pcm: Buffer, sampleRate: number): Buffer {
  if (
    pcm.length % 2 ||
    pcm.length > MAX_SPEECH_AUDIO_BYTES ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  )
    throw new Error("Speech audio has an invalid size or sample rate.");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function collectSpeechPcm(result: SpeechStreamResult, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => result.stream.destroy(new Error("Speech request was stopped."));
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const chunk of result.stream) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_SPEECH_AUDIO_BYTES)
        throw new Error("Speech audio exceeds the playback limit.");
      chunks.push(bytes);
    }
    signal.throwIfAborted();
    if (size === 0) throw new Error("Speech response did not contain audio.");
    if (!result.format.startsWith("pcm"))
      throw new Error("Speech provider returned an unsupported audio format.");
    return {
      pcm: Buffer.concat(chunks),
      sampleRate: parsePcmRateFromFormat(result.format, 24000) ?? 24000,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    result.stream.destroy();
  }
}
