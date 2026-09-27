// A hosted browser frame, host to client. The picture travels as bytes beside
// the JSON response that describes it, which spares the third that base64 adds.
//
// Layout: opcode, request id length, request id, JPEG bytes.

export const BROWSER_FRAME_OPCODE = 0x20;

export interface BrowserFrame {
  requestId: string;
  image: Uint8Array;
}

export function encodeBrowserFrame(frame: BrowserFrame): Uint8Array {
  const requestId = new TextEncoder().encode(frame.requestId);
  if (requestId.byteLength === 0 || requestId.byteLength > 0xff)
    throw new RangeError("Browser frame requestId must be 1 to 255 bytes");
  const bytes = new Uint8Array(2 + requestId.byteLength + frame.image.byteLength);
  bytes[0] = BROWSER_FRAME_OPCODE;
  bytes[1] = requestId.byteLength;
  bytes.set(requestId, 2);
  bytes.set(frame.image, 2 + requestId.byteLength);
  return bytes;
}

export function decodeBrowserFrame(bytes: Uint8Array): BrowserFrame | null {
  if (bytes.byteLength < 3 || bytes[0] !== BROWSER_FRAME_OPCODE) return null;
  const requestIdLength = bytes[1]!;
  if (requestIdLength === 0 || requestIdLength > bytes.byteLength - 2) return null;
  return {
    requestId: new TextDecoder().decode(bytes.subarray(2, 2 + requestIdLength)),
    image: bytes.subarray(2 + requestIdLength),
  };
}
