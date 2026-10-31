import { Readable } from "node:stream";

/** Use the response's standard reader, not DOM.AsyncIterable declarations.
 * The emitter build and native-preview checker load different DOM libraries.
 * Destroying output cancels the pending HTTP reader before generator teardown.
 */
export function nodeSpeechStream(body: ReadableStream<Uint8Array>): Readable {
  const reader = body.getReader();
  let complete = false;
  async function* chunks() {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          complete = true;
          return;
        }
        yield result.value;
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const stream = Readable.from(chunks());
  const destroy = stream.destroy.bind(stream);
  function cancelReader() {
    void reader.cancel().catch(() => {});
  }
  stream.destroy = (error) => {
    if (!complete) cancelReader();
    return destroy(error);
  };
  return stream;
}
