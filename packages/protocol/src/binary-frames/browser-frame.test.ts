import { describe, expect, it } from "vitest";
import { decodeBinaryFrame } from "./demux.js";
import { decodeBrowserFrame, encodeBrowserFrame } from "./browser-frame.js";

describe("browser frame codec", () => {
  it("carries a picture and the request it answers", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const decoded = decodeBrowserFrame(encodeBrowserFrame({ requestId: "frame-7", image }));

    expect(decoded?.requestId).toBe("frame-7");
    expect([...decoded!.image]).toEqual([...image]);
  });

  it("rejects bytes that are not a browser frame", () => {
    expect(decodeBrowserFrame(new Uint8Array([0x01, 0, 0, 0]))).toBeNull();
    expect(decodeBrowserFrame(new Uint8Array([0x20, 9, 1]))).toBeNull();
    expect(decodeBrowserFrame(new Uint8Array([0x20]))).toBeNull();
  });

  it("refuses a request id the length byte cannot hold", () => {
    expect(() => encodeBrowserFrame({ requestId: "", image: new Uint8Array() })).toThrow();
    expect(() =>
      encodeBrowserFrame({ requestId: "x".repeat(256), image: new Uint8Array() }),
    ).toThrow();
  });

  it("is not mistaken for a terminal or file frame by the host demux", () => {
    const frame = encodeBrowserFrame({ requestId: "frame-7", image: new Uint8Array([1]) });
    expect(decodeBinaryFrame(frame)).toBeNull();
  });
});
