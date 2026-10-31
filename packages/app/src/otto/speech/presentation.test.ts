import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { speechGain } from "./gain";
import { createSpeechSegments } from "./segments";
import type { StreamItem } from "@/types/stream";
const message = (id: string, text: string, turnId = "turn"): StreamItem => ({
  kind: "assistant_message",
  id,
  messageId: id,
  text,
  turnId,
  timestamp: new Date(0),
});
describe("spoken presentation", () => {
  it("scales signed PCM16 samples without changing sample count or requiring an audio device", async () => {
    const bytes = Buffer.alloc(6);
    bytes.writeInt16LE(10000, 0);
    bytes.writeInt16LE(-10000, 2);
    bytes.writeInt16LE(0, 4);
    const shared = Uint8Array.from(bytes).buffer;
    const result = await speechGain(
      { type: "audio/pcm;rate=24000", size: 6, arrayBuffer: async () => shared },
      50,
    );
    const output = Buffer.from(await result.arrayBuffer());
    expect([output.readInt16LE(0), output.readInt16LE(2), output.readInt16LE(4)]).toEqual([
      5000, -5000, 0,
    ]);
    expect(result.size).toBe(6);
    expect(bytes.readInt16LE(0)).toBe(10000);
    expect(Buffer.from(shared).readInt16LE(0)).toBe(10000);
  });
  it("does not replay finished history, then reads each new finished paragraph and final paragraph once", () => {
    const feed = createSpeechSegments();
    const past = message("past", "Past", "past-turn");
    const first = message("one", "First.");
    const second = message("two", "Second.");
    expect(feed.update([past, first], "turn")).toEqual([]);
    expect(feed.update([past, first, second], "turn").map((entry) => entry.text)).toEqual([
      "First.",
    ]);
    expect(feed.update([past, first, second], "turn")).toEqual([]);
    expect(feed.update([past, first, second], null).map((entry) => entry.text)).toEqual([
      "Second.",
    ]);
    expect(feed.update([past, first, second], null)).toEqual([]);
  });
  it("seeds a mid-turn attachment, and flushes its remaining paragraph before adopting the next turn", () => {
    const feed = createSpeechSegments();
    const first = message("one", "Already finished.");
    const last = message("two", "Still writing.");
    expect(feed.update([first, last], "turn")).toEqual([]);
    const next = message("three", "Next reply.", "next");
    expect(feed.update([first, last, next], "next").map((entry) => entry.text)).toEqual([
      "Still writing.",
    ]);
    expect(feed.update([first, last, next], null).map((entry) => entry.text)).toEqual([
      "Next reply.",
    ]);
  });
});
