import { describe, expect, it } from "vitest";
import { base64ToBytes } from "./base64";

/**
 * This decoder sits on the path every dropped image and every exported PDF
 * takes, and a wrong byte here is a corrupted file rather than a visible error.
 * The cases below are the ones that actually break hand-rolled decoders.
 */
describe("base64ToBytes", () => {
  it("decodes ASCII", () => {
    expect(new TextDecoder().decode(base64ToBytes("aGVsbG8="))).toBe("hello");
  });

  it("returns an empty array for an empty string", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array());
  });

  /**
   * The classic failure. `charCodeAt` above 0x7F is where a decoder that assumed
   * ASCII, or that let a value sign-extend, quietly corrupts binary. A PNG is
   * full of these: its very first byte is 0x89.
   */
  it("preserves bytes above 0x7F", () => {
    expect(base64ToBytes("iVBORw==")).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(base64ToBytes("gP8A")).toEqual(new Uint8Array([0x80, 0xff, 0x00]));
  });

  it("handles every padding length", () => {
    // 3 bytes needs no padding, 2 needs one `=`, 1 needs two.
    expect(base64ToBytes("AAAA")).toEqual(new Uint8Array([0, 0, 0]));
    expect(base64ToBytes("AAA=")).toEqual(new Uint8Array([0, 0]));
    expect(base64ToBytes("AA==")).toEqual(new Uint8Array([0]));
  });

  it("round-trips the full byte range", () => {
    const original = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) {
      original[index] = index;
    }
    const encoded = btoa(String.fromCharCode(...original));
    expect(base64ToBytes(encoded)).toEqual(original);
  });

  it("decodes a real PNG signature", () => {
    // The 8-byte PNG magic, which is what a dropped screenshot starts with.
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(base64ToBytes(btoa(String.fromCharCode(...signature)))).toEqual(signature);
  });
});
