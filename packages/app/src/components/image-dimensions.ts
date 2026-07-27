// Natural pixel size of an image, read from the bytes we already have.
//
// The viewer needs this *before* it can lay anything out: fit-to-pane, the zoom
// percentage and the status-bar readout are all ratios against the natural
// size, and there is no cross-platform way to ask for it. `Image.getSize` is
// asynchronous, unavailable for the raw SVG branch, and would make the first
// frame guess — so the size is parsed from the container headers instead, which
// costs a few dozen bytes of reading and is done by the time the pane renders.
//
// Every parser here reads a header and nothing more: no pixel data is decoded,
// so cost is independent of file size. A format we cannot read returns null,
// and the viewer degrades to the plain contain-fit it had before — an unknown
// size is an ordinary answer, never an error.

export interface ImageDimensions {
  width: number;
  height: number;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

/** Unsigned: `>>> 0` because a 32-bit value with the top bit set is negative in JS. */
function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function i32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24) |
    0
  );
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

/** A size is only usable if both axes are real, positive, finite numbers. */
function validate(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** IHDR is mandated to be the first chunk, so its width/height sit at a fixed offset. */
function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || !matchesAscii(bytes, 12, "IHDR")) {
    return null;
  }
  return validate(u32be(bytes, 16), u32be(bytes, 20));
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) {
    return null;
  }
  // The logical screen descriptor, not the first frame — an animation's frames
  // may be smaller than the canvas they compose onto.
  return validate(u16le(bytes, 6), u16le(bytes, 8));
}

function bmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 26) {
    return null;
  }
  // A negative height means the rows are stored top-down; the magnitude is
  // still the image height.
  return validate(i32le(bytes, 18), Math.abs(i32le(bytes, 22)));
}

/**
 * SOF0–SOF15 carry the frame size. `c4`/`c8`/`cc` are DHT/JPG/DAC — same
 * numeric range, not frame headers, and reading them as one yields garbage.
 */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  // 9 bytes is the smallest segment that could still answer: marker, length
  // and the SOF's precision/height/width triple.
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Padding before a marker is legal; skip a byte and resync rather than
      // giving up on an otherwise readable file.
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers (RSTn, SOI, TEM) carry no length word.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) {
      return null;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2) {
      return null;
    }
    if (isStartOfFrame(marker)) {
      return validate(u16be(bytes, offset + 7), u16be(bytes, offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP");
}

/**
 * Three sub-formats behind one container, each storing the canvas differently.
 * VP8X wins when present: it is the extended header an animated or alpha file
 * carries, and it names the canvas the frames compose onto.
 */
function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (matchesAscii(bytes, 12, "VP8X") && bytes.length >= 30) {
    return validate(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  if (matchesAscii(bytes, 12, "VP8L") && bytes.length >= 25) {
    // 14 bits per axis, packed little-endian after the 0x2f signature byte.
    if (bytes[20] !== 0x2f) {
      return null;
    }
    const bits =
      ((bytes[21] ?? 0) |
        ((bytes[22] ?? 0) << 8) |
        ((bytes[23] ?? 0) << 16) |
        ((bytes[24] ?? 0) << 24)) >>>
      0;
    return validate((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (matchesAscii(bytes, 12, "VP8 ") && bytes.length >= 30) {
    // The keyframe start code guards against reading a corrupt stream.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return validate(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  return null;
}

function isIco(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    (bytes[2] === 0x01 || bytes[2] === 0x02) &&
    bytes[3] === 0x00
  );
}

function icoDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (u16le(bytes, 4) < 1) {
    return null;
  }
  // One byte per axis, where 0 means 256 — the format's way of fitting the
  // largest legal icon into a byte.
  return validate((bytes[6] ?? 0) || 256, (bytes[7] ?? 0) || 256);
}

function svgAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match?.[2] ?? match?.[3] ?? null;
}

/**
 * SVG lengths are only a pixel count when they are unitless or in `px`. A
 * percentage or an `em` sizes against a context the viewer does not have, so it
 * falls through to the viewBox rather than inventing a number.
 */
function svgLength(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function svgDimensions(bytes: Uint8Array): ImageDimensions | null {
  // The root tag is near the front even behind an XML declaration, a DOCTYPE
  // and comments; decoding the whole file to find it would be wasteful for an
  // SVG that is mostly path data.
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) {
    return null;
  }
  const width = svgLength(svgAttribute(tag, "width"));
  const height = svgLength(svgAttribute(tag, "height"));
  if (width !== null && height !== null) {
    return validate(width, height);
  }
  const viewBox = svgAttribute(tag, "viewBox");
  if (!viewBox) {
    return null;
  }
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return validate(parts[2] ?? 0, parts[3] ?? 0);
}

function looksLikeSvg(bytes: Uint8Array, mime: string | undefined): boolean {
  if (mime === "image/svg+xml") {
    return true;
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!DOCTYPE svg");
}

/**
 * The natural size of an image, or null when the format is one we do not parse
 * (or the bytes are truncated). Sniffs the container rather than trusting the
 * MIME type, which the daemon derives from the extension — a `.png` holding a
 * JPEG should still measure correctly. `mime` is consulted only for SVG, which
 * has no magic number of its own.
 */
export function readImageDimensions(bytes: Uint8Array, mime?: string): ImageDimensions | null {
  if (bytes.length < 8) {
    return null;
  }
  if (isPng(bytes)) {
    return pngDimensions(bytes);
  }
  if (matchesAscii(bytes, 0, "GIF8")) {
    return gifDimensions(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegDimensions(bytes);
  }
  if (isWebp(bytes)) {
    return webpDimensions(bytes);
  }
  if (matchesAscii(bytes, 0, "BM")) {
    return bmpDimensions(bytes);
  }
  if (isIco(bytes)) {
    return icoDimensions(bytes);
  }
  if (looksLikeSvg(bytes, mime)) {
    return svgDimensions(bytes);
  }
  return null;
}
