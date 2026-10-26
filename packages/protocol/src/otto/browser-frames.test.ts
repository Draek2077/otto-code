import { expect, test } from "vitest";
import {
  encodeBrowserPaintEnd,
  decodeBrowserPaintEnd,
  decodeBrowserPaintFrame,
  encodeBrowserPaintFrame,
  OTTO_BROWSER_FRAME_MAX_JPEG_BYTES,
} from "./browser-frames.js";
const ticket = "01234567-89ab-4cde-8fab-0123456789ab";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const frame = { ticket, sequence: 0x01020304, viewportWidth: 1280, viewportHeight: 720, jpeg };
test.each(["closed", "error"] as const)(
  "paint-end %s has a fixed ticket-bound header with no text or JPEG",
  (reason) => {
    const bytes = encodeBrowserPaintEnd({ ticket, reason });
    expect(bytes).toHaveLength(32);
    expect(decodeBrowserPaintEnd(bytes)).toEqual({ ticket, reason });
    expect(decodeBrowserPaintFrame(bytes)).toBeNull();
    const offset = new Uint8Array(35);
    offset.set(bytes, 3);
    expect(decodeBrowserPaintEnd(offset.subarray(3))).toEqual({ ticket, reason });
  },
);
test("paint-end rejects unknown versions, flags, payloads and non-v4 ticket identities", () => {
  const bytes = encodeBrowserPaintEnd({ ticket, reason: "error" });
  for (const index of [1, 2, 3, 20, 24, 28]) {
    const invalid = bytes.slice();
    invalid[index] = 9;
    expect(decodeBrowserPaintEnd(invalid)).toBeNull();
  }
  expect(decodeBrowserPaintEnd(new Uint8Array([...bytes, 1]))).toBeNull();
  expect(() => encodeBrowserPaintEnd({ ticket: "not-a-ticket", reason: "closed" })).toThrow();
  const invalid = bytes.slice();
  invalid[10] = 0;
  expect(decodeBrowserPaintEnd(invalid)).toBeNull();
});
test("the encrypted application frame uses a stable independent network-order header below the relay limit", () => {
  const encoded = encodeBrowserPaintFrame(frame);
  expect(Buffer.from(encoded).toString("hex")).toBe(
    "200100000123456789ab4cde8fab0123456789ab01020304050002d000000004ffd8ffd9",
  );
  const container = new Uint8Array(encoded.length + 19);
  container.set(encoded, 7);
  expect(decodeBrowserPaintFrame(container.subarray(7, 7 + encoded.length))).toEqual(frame);
  expect(encoded.length).toBeLessThan(1048576);
});
test.each([
  { ticket: "not-a-viewer" },
  { sequence: 0 },
  { sequence: 0x100000000 },
  { viewportWidth: 0 },
  { viewportHeight: 4097 },
  { jpeg: new Uint8Array(OTTO_BROWSER_FRAME_MAX_JPEG_BYTES + 1) },
])("invalid paint metadata is refused before allocation: %j", (patch) => {
  expect(() => encodeBrowserPaintFrame({ ...frame, ...patch })).toThrow(RangeError);
});
test.each([
  { offset: 0, value: 0x01 },
  { offset: 1, value: 2 },
  { offset: 2, value: 1 },
  { offset: 3, value: 1 },
  { offset: 10, value: 0 },
  { offset: 23, value: 0 },
  { offset: 31, value: 3 },
  { offset: 32, value: 0 },
])("malformed or cross-family headers never become a paint frame: %j", ({ offset, value }) => {
  const encoded = encodeBrowserPaintFrame({ ...frame, sequence: 1 });
  encoded[offset] = value;
  expect(decodeBrowserPaintFrame(encoded)).toBeNull();
});
test("truncated payloads and impossible lengths are rejected without a partial image", () => {
  const encoded = encodeBrowserPaintFrame(frame);
  expect(decodeBrowserPaintFrame(encoded.subarray(0, encoded.length - 1))).toBeNull();
  const oversized = new Uint8Array(OTTO_BROWSER_FRAME_MAX_JPEG_BYTES + 33);
  expect(decodeBrowserPaintFrame(oversized)).toBeNull();
});
