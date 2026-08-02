/**
 * base64 to bytes, for payloads that reach the app already encoded — the
 * desktop print bridge and the editor webview both hand back strings, because
 * both cross a JSON boundary that cannot carry a `Uint8Array`.
 *
 * The decode belongs here, at the edge, rather than any deeper: past this point
 * the daemon client sends bytes as binary frames, and re-encoding them would
 * put the third the frames exist to save back on the wire.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
