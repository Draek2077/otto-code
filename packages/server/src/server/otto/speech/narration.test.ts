import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { SpeechStreamResult } from "../../speech/speech-provider.js";
import { createNarrationStream } from "./narration.js";
const audio = (bytes = [1, 0], format = "pcm;rate=24000"): SpeechStreamResult => ({
  stream: Readable.from([Buffer.from(bytes)]),
  format,
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
describe("live narration stream", () => {
  it("streams normalized sentences with real punctuation silence and releases the shared runtime once", async () => {
    const synthesizeSpeech = vi.fn(async (_text: string) => audio());
    const release = vi.fn();
    const result = await createNarrationStream(
      { synthesizeSpeech },
      "First sentence. Second sentence?",
      release,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(synthesizeSpeech.mock.calls.map(([text]) => text)).toEqual([
      "First sentence.",
      "Second sentence?",
    ]);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 19200, 2]);
    expect(chunks[1]!.equals(Buffer.alloc(19200))).toBe(true);
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("holds a cancelled native lease until generation settles and never emits its late samples", async () => {
    let complete!: (value: SpeechStreamResult) => void;
    const native = new Promise<SpeechStreamResult>((resolve) => {
      complete = resolve;
    });
    const synthesizeSpeech = vi
      .fn(async (_text: string) => audio())
      .mockImplementationOnce(async () => audio())
      .mockImplementationOnce(() => native);
    const release = vi.fn();
    const result = await createNarrationStream({ synthesizeSpeech }, "First. Second.", release);
    const chunks: Buffer[] = [];
    const consuming = (async () => {
      for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    })().catch(() => undefined);
    await expect.poll(() => synthesizeSpeech.mock.calls.length).toBe(2);
    result.stream.destroy();
    expect(release).not.toHaveBeenCalled();
    const late = audio([9, 0]);
    complete(late);
    await consuming;
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(late.stream.destroyed).toBe(true);
    expect(Buffer.concat(chunks).includes(9)).toBe(false);
  });
  it("rejects a provider's sample-rate change and still releases the lease", async () => {
    const synthesizeSpeech = vi
      .fn(async (_text: string) => audio())
      .mockImplementationOnce(async () => audio())
      .mockImplementationOnce(async () => audio([2, 0], "pcm;rate=16000"));
    const release = vi.fn();
    const result = await createNarrationStream({ synthesizeSpeech }, "First. Second.", release);
    const consuming = async () => {
      for await (const _chunk of result.stream) {
        /* consume the real stream */
      }
    };
    await expect(consuming()).rejects.toThrow("sample rate changed");
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
