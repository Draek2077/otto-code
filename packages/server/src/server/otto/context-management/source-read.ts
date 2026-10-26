import { open, realpath } from "node:fs/promises";
import { withContextCleanup } from "./cleanup.js";

/** Bounded ordinary-file read; reject lossy decoding before any source rewrite. */
export async function readContextSource(file: string): Promise<string> {
  if ((await realpath(file)) !== file)
    throw new Error("The context source changed its filesystem identity.");
  const handle = await open(file, "r");
  return withContextCleanup(
    async () => {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 131072)
        throw new Error("This source is not an ordinary file within the 128 KiB context limit.");
      const buffer = Buffer.alloc(131073);
      let size = 0;
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, null);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > 131072) throw new Error("This source exceeds the 128 KiB context limit.");
      const bytes = buffer.subarray(0, size),
        text = bytes.toString("utf8");
      if (text.includes("\0") || !Buffer.from(text, "utf8").equals(bytes))
        throw new Error(
          "Context source must be UTF-8 text. Its original bytes were left unchanged.",
        );
      if ((await realpath(file)) !== file)
        throw new Error("The context source changed its filesystem identity.");
      return text;
    },
    () => handle.close(),
  );
}
