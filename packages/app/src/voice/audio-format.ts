// Maps a synthesized-audio format id from the host (speech/TTS responses) to a
// mime type the voice audio engine can play.
//
// Local Sherpa returns "pcm;rate=24000"; OpenAI returns "pcm" (24 kHz default).
// The audio engine parses `rate=` from the mime type and defaults to 24000.
export function formatToMimeType(format: string): string {
  if (format === "pcm") return "audio/pcm;rate=24000;bits=16";
  if (format === "mp3") return "audio/mpeg";
  return `audio/${format}`;
}
