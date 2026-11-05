import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./image-dimensions";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

function u32be(value: number): Uint8Array {
  return bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function u16be(value: number): Uint8Array {
  return bytes((value >>> 8) & 0xff, value & 0xff);
}

function u16le(value: number): Uint8Array {
  return bytes(value & 0xff, (value >>> 8) & 0xff);
}

function u32le(value: number): Uint8Array {
  return bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function png(width: number, height: number): Uint8Array {
  return concat(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    u32be(13),
    ascii("IHDR"),
    u32be(width),
    u32be(height),
    bytes(8, 6, 0, 0, 0),
  );
}

describe("readImageDimensions", () => {
  it("reads a PNG's IHDR", () => {
    expect(readImageDimensions(png(1024, 720))).toEqual({ width: 1024, height: 720 });
  });

  it("reads a PNG wider than a signed 16-bit value", () => {
    expect(readImageDimensions(png(70000, 3))).toEqual({ width: 70000, height: 3 });
  });

  it("rejects a PNG truncated before IHDR", () => {
    expect(readImageDimensions(png(10, 10).subarray(0, 18))).toBeNull();
  });

  it("reads a GIF's logical screen descriptor", () => {
    const gif = concat(ascii("GIF89a"), u16le(300), u16le(200), bytes(0, 0, 0));
    expect(readImageDimensions(gif)).toEqual({ width: 300, height: 200 });
  });

  it("reads a BMP header", () => {
    const bmp = concat(ascii("BM"), new Uint8Array(16), u32le(640), u32le(480), new Uint8Array(4));
    expect(readImageDimensions(bmp)).toEqual({ width: 640, height: 480 });
  });

  it("treats a negative BMP height as top-down storage, not a bad size", () => {
    const bmp = concat(
      ascii("BM"),
      new Uint8Array(16),
      u32le(640),
      u32le(0xffffffff - 480 + 1),
      new Uint8Array(4),
    );
    expect(readImageDimensions(bmp)).toEqual({ width: 640, height: 480 });
  });

  it("walks JPEG segments to the start-of-frame", () => {
    const jpeg = concat(
      bytes(0xff, 0xd8),
      // APP0/JFIF: a segment that must be skipped by its declared length.
      bytes(0xff, 0xe0),
      u16be(16),
      ascii("JFIF\0"),
      new Uint8Array(9),
      // SOF0: precision, height, width.
      bytes(0xff, 0xc0),
      u16be(17),
      bytes(8),
      u16be(400),
      u16be(600),
      new Uint8Array(10),
    );
    expect(readImageDimensions(jpeg)).toEqual({ width: 600, height: 400 });
  });

  it("does not mistake a Huffman table for a frame header", () => {
    const jpeg = concat(
      bytes(0xff, 0xd8),
      // DHT shares SOF's marker range and would read as 0x0102 × 0x0304.
      bytes(0xff, 0xc4),
      u16be(10),
      bytes(0, 1, 2, 3, 4, 5, 6, 7),
      bytes(0xff, 0xc2),
      u16be(17),
      bytes(8),
      u16be(120),
      u16be(160),
      new Uint8Array(10),
    );
    expect(readImageDimensions(jpeg)).toEqual({ width: 160, height: 120 });
  });

  it("reads a lossy WebP keyframe", () => {
    const webp = concat(
      ascii("RIFF"),
      u32le(100),
      ascii("WEBP"),
      ascii("VP8 "),
      u32le(80),
      bytes(0, 0, 0),
      bytes(0x9d, 0x01, 0x2a),
      u16le(320),
      u16le(240),
      new Uint8Array(4),
    );
    expect(readImageDimensions(webp)).toEqual({ width: 320, height: 240 });
  });

  it("reads a VP8X canvas, which an animated or alpha WebP carries", () => {
    const webp = concat(
      ascii("RIFF"),
      u32le(200),
      ascii("WEBP"),
      ascii("VP8X"),
      u32le(10),
      bytes(0x10, 0, 0, 0),
      // Canvas size is stored minus one, 24 bits per axis.
      bytes(0x3f, 0x00, 0x00),
      bytes(0x1f, 0x00, 0x00),
      new Uint8Array(4),
    );
    expect(readImageDimensions(webp)).toEqual({ width: 64, height: 32 });
  });

  it("reads an ICO directory entry, where 0 means 256", () => {
    const ico = concat(u16le(0), u16le(1), u16le(1), bytes(0, 0), new Uint8Array(10));
    expect(readImageDimensions(ico)).toEqual({ width: 256, height: 256 });
  });

  it("prefers an SVG's explicit width and height", () => {
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="24" />');
    expect(readImageDimensions(svg, "image/svg+xml")).toEqual({ width: 48, height: 24 });
  });

  it("falls back to the viewBox when the SVG sizes itself in percentages", () => {
    const svg = ascii('<svg width="100%" height="100%" viewBox="0 0 200 100"></svg>');
    expect(readImageDimensions(svg, "image/svg+xml")).toEqual({ width: 200, height: 100 });
  });

  it("finds the root tag behind an XML declaration and a comment", () => {
    const svg = ascii('<?xml version="1.0"?>\n<!-- generated -->\n<svg viewBox="0 0 10 5"></svg>');
    expect(readImageDimensions(svg, "image/svg+xml")).toEqual({ width: 10, height: 5 });
  });

  it("sniffs the container rather than trusting a wrong MIME type", () => {
    expect(readImageDimensions(png(8, 8), "image/jpeg")).toEqual({ width: 8, height: 8 });
  });

  it("returns null for a format it does not parse", () => {
    expect(readImageDimensions(ascii("not an image at all"))).toBeNull();
  });

  it("returns null for bytes too short to hold any header", () => {
    expect(readImageDimensions(bytes(0x89, 0x50))).toBeNull();
  });
});
