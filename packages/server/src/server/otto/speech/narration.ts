import { Readable } from "node:stream";
import type { TextToSpeechProvider, SpeechStreamResult } from "../../speech/speech-provider.js";
import { parsePcmRateFromFormat } from "../../speech/audio.js";
import { splitTextForTts, appendPauseSilence } from "./tts-segmenter.js";
import { MAX_SPEECH_AUDIO_BYTES } from "./audio.js";

/** Live voice keeps Paseo's existing stream/backpressure path. The restored
 * normalization/cadence is shared with read-aloud; cancellation holds the lease
 * until any non-interruptible native generation really settles.
 */
export async function createNarrationStream(
  provider: TextToSpeechProvider,
  text: string,
  release: () => void,
): Promise<SpeechStreamResult> {
  const segments = splitTextForTts(text);
  let pending = provider.synthesizeSpeech(segments[0]!.text);
  const first = await pending;
  let activeStream = first.stream;
  const rate = parsePcmRateFromFormat(first.format, 24000);
  let closed = false;
  let size = 0;
  async function* audio() {
    for (const segment of segments) {
      if (closed) return;
      if (segment.index !== 0) pending = provider.synthesizeSpeech(segment.text);
      const result = segment.index === 0 ? first : await pending;
      if (closed) {
        result.stream.destroy();
        return;
      }
      activeStream = result.stream;
      try {
        if (parsePcmRateFromFormat(result.format, 24000) !== rate)
          throw new Error("Speech sample rate changed during narration.");
        for await (const chunk of result.stream) {
          if (closed) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_SPEECH_AUDIO_BYTES)
            throw new Error("Speech audio exceeds the playback limit.");
          yield bytes;
        }
        const pause = appendPauseSilence(Buffer.alloc(0), result.format, segment.pauseAfterMs);
        size += pause.length;
        if (size > MAX_SPEECH_AUDIO_BYTES)
          throw new Error("Speech audio exceeds the playback limit.");
        if (pause.length) yield pause;
      } finally {
        result.stream.destroy();
      }
    }
  }
  const stream = Readable.from(audio());
  const finish = () => {
    if (closed) return;
    closed = true;
    activeStream.destroy();
    void pending.then(
      (result) => {
        result.stream.destroy();
        release();
        return undefined;
      },
      () => {
        release();
        return undefined;
      },
    );
  };
  const destroy = stream.destroy.bind(stream);
  // Readable.from can be waiting inside the generator's next(). Cancel its
  // active input before asking that generator to close, avoiding a stalled read.
  stream.destroy = (error) => {
    finish();
    return destroy(error);
  };
  stream.once("end", finish).once("close", finish).once("error", finish);
  return { stream, format: first.format };
}
