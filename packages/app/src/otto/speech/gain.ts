import { Buffer } from "buffer";
import type { AudioPlaybackSource } from "@/audio";
/** Both current live voice (PCM16) and restored read-aloud (WAV PCM16) share
 * the existing engine. Scaling samples here also works on native file playback
 * without requesting microphone permission or creating another audio engine.
 */
export async function speechGain(
  source: AudioPlaybackSource,
  percent: number,
): Promise<AudioPlaybackSource> {
  const gain = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 50)) / 100;
  if (gain === 1) return source;
  // Copy: thinking-tone sources reuse their buffer. Mutating it would compound
  // gain on every repeat and eventually silence the tone.
  const data = Buffer.from(new Uint8Array(await source.arrayBuffer()));
  let start = 0;
  let end = data.length;
  if (source.type.startsWith("audio/wav")) {
    if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE")
      return source;
    let found = false;
    let pcm16 = false;
    for (let offset = 12; offset + 8 <= data.length; ) {
      const length = data.readUInt32LE(offset + 4);
      if (offset + 8 + length > data.length) return source;
      if (data.toString("ascii", offset, offset + 4) === "fmt ") {
        pcm16 =
          length >= 16 &&
          data.readUInt16LE(offset + 8) === 1 &&
          data.readUInt16LE(offset + 22) === 16;
      }
      if (data.toString("ascii", offset, offset + 4) === "data") {
        if (!pcm16) return source;
        start = offset + 8;
        end = start + length;
        found = true;
        break;
      }
      offset += 8 + length + (length % 2);
    }
    if (!found) return source;
  } else if (
    !source.type.startsWith("audio/pcm") ||
    /(?:^|;)\s*bits=(?!16(?:;|$))/.test(source.type)
  )
    return source;
  for (let offset = start; offset + 1 < end; offset += 2)
    data.writeInt16LE(Math.round(data.readInt16LE(offset) * gain), offset);
  return {
    ...source,
    type: source.type,
    size: data.length,
    arrayBuffer: async () => Uint8Array.from(data).buffer,
  };
}
