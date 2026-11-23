import type { SpeechStreamResult } from "../../speech/speech-provider.js";
import { collectSpeechPcm, speechWav, MAX_SPEECH_AUDIO_BYTES } from "./audio.js";
import { appendPauseSilence } from "./tts-segmenter.js";

/** Await native completion before observing cancellation. A stopped client wait
 * must never release its runtime lease while sherpa is still generating audio.
 * Cadence is real PCM silence, so no browser timers or second audio stack exist.
 */
export async function generateSpeechWav(
  text: string,
  generate: (text: string) => Promise<SpeechStreamResult>,
  signal: AbortSignal,
  pauseAfterMs = 0,
) {
  signal.throwIfAborted();
  // The host prepare RPC already normalized this segment once. Do not parse
  // the returned prose as Markdown again.
  const result = await generate(text);
  const audio = await collectSpeechPcm(result, signal);
  const bytes = appendPauseSilence(audio.pcm, result.format, pauseAfterMs);
  if (bytes.length > MAX_SPEECH_AUDIO_BYTES)
    throw new Error("Speech audio exceeds the playback limit.");
  signal.throwIfAborted();
  return {
    base64: speechWav(bytes, audio.sampleRate).toString("base64"),
    mimeType: "audio/wav" as const,
  };
}
