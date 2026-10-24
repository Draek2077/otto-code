/** Settings writes are explicit, revisioned documents; secrets need not enter shell history. */
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { z } from "zod";
import { BrainCliError } from "./rpc.js";

export async function readBrainInput(
  source: string,
  schema: z.ZodType,
  stdin: Readable = process.stdin,
): Promise<unknown> {
  const stream = source === "-" ? stdin : createReadStream(source);
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 128 * 1024) throw new Error("input limit");
      chunks.push(buffer);
    }
    const result = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (result.success) return result.data;
  } catch (cause) {
    throw new BrainCliError(
      "BRAIN_INPUT_INVALID",
      "Read a valid Brain JSON document of at most 128 KiB from --input <file|->.",
      { cause },
    );
  }
  throw new BrainCliError(
    "BRAIN_INPUT_INVALID",
    "Check the Brain JSON fields and originating revision. No request was sent.",
  );
}
