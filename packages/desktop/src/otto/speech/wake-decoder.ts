export interface NativeKeywordStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
}
export interface NativeKeywordSpotter {
  createStream(): NativeKeywordStream;
  isReady(stream: NativeKeywordStream): boolean;
  decode(stream: NativeKeywordStream): void;
  getResult(stream: NativeKeywordStream): { keyword?: string };
}
/** Bounded local IPC PCM, checking the result after each native decode step. */
export function decodeWakePcm(
  spotter: NativeKeywordSpotter,
  stream: NativeKeywordStream,
  encoded: string,
): boolean {
  if (encoded.length > 87384) throw new Error("Invalid detector PCM chunk.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 65536 || bytes.length % 2 !== 0)
    throw new Error("Invalid detector PCM format.");
  if (!bytes.length) return false;
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index++)
    samples[index] = bytes.readInt16LE(index * 2) / 32768;
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  let steps = 0;
  while (spotter.isReady(stream)) {
    if (++steps > 512) throw new Error("Wake-word detector exceeded its decode bound.");
    spotter.decode(stream);
    if (spotter.getResult(stream).keyword) return true;
  }
  return false;
}
