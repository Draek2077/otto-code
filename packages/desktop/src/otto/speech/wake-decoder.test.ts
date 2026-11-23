import { describe, expect, it, vi } from "vitest";
import { decodeWakePcm } from "./wake-decoder.js";
function fixture() {
  const stream = { acceptWaveform: vi.fn() };
  let step = 0;
  const spotter = {
    createStream: () => stream,
    isReady: () => step < 3,
    decode: () => {
      step++;
    },
    getResult: () => ({ keyword: step === 1 ? "Hey Otto" : "" }),
  };
  return { stream, spotter };
}
describe("local detector decode", () => {
  it("preserves PCM polarity and catches a transient result before the next decode", () => {
    const f = fixture();
    const bytes = Buffer.alloc(4);
    bytes.writeInt16LE(-32768, 0);
    bytes.writeInt16LE(16384, 2);
    expect(decodeWakePcm(f.spotter, f.stream, bytes.toString("base64"))).toBe(true);
    expect(f.stream.acceptWaveform).toHaveBeenCalledExactlyOnceWith({
      samples: new Float32Array([-1, 0.5]),
      sampleRate: 16000,
    });
  });
  it("rejects oversized and odd PCM before entering native code", () => {
    const f = fixture();
    expect(() => decodeWakePcm(f.spotter, f.stream, "A".repeat(87385))).toThrow("chunk");
    expect(() => decodeWakePcm(f.spotter, f.stream, Buffer.from([1]).toString("base64"))).toThrow(
      "format",
    );
    expect(f.stream.acceptWaveform).not.toHaveBeenCalled();
  });
  it("bounds an unhealthy native decode loop", () => {
    const f = fixture();
    f.spotter.isReady = () => true;
    f.spotter.getResult = () => ({ keyword: "" });
    expect(() => decodeWakePcm(f.spotter, f.stream, Buffer.alloc(2).toString("base64"))).toThrow(
      "decode bound",
    );
  });
});
