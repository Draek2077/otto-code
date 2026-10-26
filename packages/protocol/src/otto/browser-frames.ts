/** Application bytes inside Paseo's encrypted transport. Never sent without a negotiated Host Browser viewer. */
export const OTTO_BROWSER_FRAME_OPCODE = 0x20;
export const OTTO_BROWSER_FRAME_HEADER_BYTES = 32;
export const OTTO_BROWSER_FRAME_MAX_JPEG_BYTES = 512 * 1024;
const ticketPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isBrowserPaintTicket(value: unknown): value is string {
  return typeof value === "string" && ticketPattern.test(value);
}
export interface BrowserPaintFrame {
  ticket: string;
  sequence: number;
  viewportWidth: number;
  viewportHeight: number;
  jpeg: Uint8Array;
}
export interface BrowserPaintEnd {
  ticket: string;
  reason: "closed" | "error";
}
/** A terminal source-owned notice, never a broadcast or a text-bearing error channel. */
export function encodeBrowserPaintEnd(notice: BrowserPaintEnd): Uint8Array {
  if (
    !isBrowserPaintTicket(notice.ticket) ||
    (notice.reason !== "closed" && notice.reason !== "error")
  )
    throw new RangeError("Invalid Host Browser paint end.");
  const bytes = new Uint8Array(OTTO_BROWSER_FRAME_HEADER_BYTES);
  bytes.set([OTTO_BROWSER_FRAME_OPCODE, 1, 1, notice.reason === "error" ? 1 : 0]);
  const ticket = notice.ticket.replaceAll("-", "");
  for (let index = 0; index < 16; index++)
    bytes[index + 4] = Number.parseInt(ticket.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
export function decodeBrowserPaintEnd(bytes: Uint8Array): BrowserPaintEnd | null {
  if (
    bytes.length !== OTTO_BROWSER_FRAME_HEADER_BYTES ||
    bytes[0] !== OTTO_BROWSER_FRAME_OPCODE ||
    bytes[1] !== 1 ||
    bytes[2] !== 1 ||
    bytes[3] > 1 ||
    bytes.subarray(20).some((byte) => byte !== 0)
  )
    return null;
  const hex = Array.from(bytes.subarray(4, 20), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  const ticket = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return isBrowserPaintTicket(ticket)
    ? { ticket, reason: bytes[3] === 1 ? "error" : "closed" }
    : null;
}
function dimension(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 4096;
}
function jpegBytes(value: Uint8Array): boolean {
  return (
    value.length >= 4 &&
    value.length <= OTTO_BROWSER_FRAME_MAX_JPEG_BYTES &&
    value[0] === 0xff &&
    value[1] === 0xd8 &&
    value[value.length - 2] === 0xff &&
    value[value.length - 1] === 0xd9
  );
}
export function encodeBrowserPaintFrame(frame: BrowserPaintFrame): Uint8Array {
  if (
    !isBrowserPaintTicket(frame.ticket) ||
    !Number.isInteger(frame.sequence) ||
    frame.sequence < 1 ||
    frame.sequence > 0xffffffff ||
    !dimension(frame.viewportWidth) ||
    !dimension(frame.viewportHeight) ||
    !jpegBytes(frame.jpeg)
  )
    throw new RangeError("Invalid Host Browser paint frame.");
  const bytes = new Uint8Array(OTTO_BROWSER_FRAME_HEADER_BYTES + frame.jpeg.byteLength);
  const view = new DataView(bytes.buffer);
  bytes[0] = OTTO_BROWSER_FRAME_OPCODE;
  bytes[1] = 1;
  const ticket = frame.ticket.replaceAll("-", "");
  for (let index = 0; index < 16; index++)
    bytes[4 + index] = Number.parseInt(ticket.slice(index * 2, index * 2 + 2), 16);
  view.setUint32(20, frame.sequence);
  view.setUint16(24, frame.viewportWidth);
  view.setUint16(26, frame.viewportHeight);
  view.setUint32(28, frame.jpeg.byteLength);
  bytes.set(frame.jpeg, OTTO_BROWSER_FRAME_HEADER_BYTES);
  return bytes;
}
/** Subarray-aware and allocation-bounded. Malformed/unknown versions never reach an image decoder. */
export function decodeBrowserPaintFrame(bytes: Uint8Array): BrowserPaintFrame | null {
  if (
    bytes.length < OTTO_BROWSER_FRAME_HEADER_BYTES + 4 ||
    bytes.length > OTTO_BROWSER_FRAME_HEADER_BYTES + OTTO_BROWSER_FRAME_MAX_JPEG_BYTES ||
    bytes[0] !== OTTO_BROWSER_FRAME_OPCODE ||
    bytes[1] !== 1 ||
    bytes[2] !== 0 ||
    bytes[3] !== 0
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = view.getUint32(20),
    viewportWidth = view.getUint16(24),
    viewportHeight = view.getUint16(26);
  if (
    !sequence ||
    !dimension(viewportWidth) ||
    !dimension(viewportHeight) ||
    view.getUint32(28) !== bytes.length - OTTO_BROWSER_FRAME_HEADER_BYTES
  )
    return null;
  const hex = Array.from(bytes.subarray(4, 20), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const ticket = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const jpeg = bytes.subarray(OTTO_BROWSER_FRAME_HEADER_BYTES);
  return isBrowserPaintTicket(ticket) && jpegBytes(jpeg)
    ? { ticket, sequence, viewportWidth, viewportHeight, jpeg }
    : null;
}
