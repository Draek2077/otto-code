import { open, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { z } from "zod";
import type { FileHandle } from "node:fs/promises";
import { exportEditorDocument } from "@getpaseo/plugin/otto/editor";
import { canonicalDocument, isInside } from "./lsp/uri.js";
import { EditorError } from "./errors.js";
type Request = z.output<typeof exportEditorDocument.input>;
/** New exported documents never overwrite an existing file. The operation ID
 * makes a lost response safe to reconcile without producing duplicate outputs. */
export class EditorExports {
  private readonly entries = new Map<
    string,
    { digest: string; promise: Promise<{ file: string }>; settled: boolean }
  >();
  private active = 0;
  write(clientId: string, request: Request, isCurrent: () => boolean) {
    const key = JSON.stringify([clientId, request.operationId]);
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.entries.get(key);
    if (previous) {
      if (digest !== previous.digest)
        throw new EditorError(
          "conflict",
          "An export identity cannot be reused for different content.",
        );
      return previous.promise;
    }
    if (this.active >= 2)
      throw new EditorError("unavailable", "Wait for another export to finish.");
    if (this.entries.size >= 128) {
      const settled = [...this.entries].find(([, entry]) => entry.settled);
      if (!settled) throw new EditorError("unavailable", "Exports are still pending.");
      this.entries.delete(settled[0]);
    }
    this.active++;
    const entry = { digest, settled: false, promise: Promise.resolve({ file: "" }) };
    entry.promise = createExport(request, isCurrent).finally(() => {
      this.active--;
      entry.settled = true;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }
}
async function createExport(request: Request, isCurrent: () => boolean) {
  if (
    !request.base64 ||
    request.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(request.base64)
  )
    throw new EditorError("invalid", "Export bytes are invalid.");
  const bytes = Buffer.from(request.base64, "base64");
  if (bytes.length > 9 * 1024 * 1024 || bytes.toString("base64") !== request.base64)
    throw new EditorError("invalid", "Export exceeds the 9 MB limit or is not canonical base64.");
  if (request.extension === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new EditorError("invalid", "The printer did not return a PDF document.");
  const paths = await canonicalDocument(request.root, request.file);
  const directory = await realpath(path.dirname(paths.file));
  if (!isInside(paths.root, directory))
    throw new EditorError("invalid", "The output directory is outside the source scope.");
  const stem = path.basename(paths.file).replace(/\.[^.]+$/u, "");
  for (let index = 0; index < 20; index++) {
    if (!isCurrent()) throw new EditorError("closed", "The export was canceled before creation.");
    const file = path.join(
      directory,
      `${stem}${index ? `-${index + 1}` : ""}.${request.extension}`,
    );
    const handle = await open(file, "wx", 0o600).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return null;
      throw error;
    });
    if (!handle) continue;
    try {
      await writeAndClose(handle, bytes);
    } catch (error) {
      try {
        await rm(file);
      } catch (cleanupError) {
        throw combinedFailure(error, cleanupError);
      }
      throw error;
    }
    return { file };
  }
  throw new EditorError(
    "conflict",
    "Twenty exports with this name already exist. Rename the source or move an older export.",
  );
}
function combinedFailure(primary: unknown, cleanup: unknown) {
  return new AggregateError([primary, cleanup], "Export and cleanup failed.", { cause: primary });
}
async function writeAndClose(handle: FileHandle, bytes: Buffer) {
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } catch (cleanupError) {
      throw combinedFailure(error, cleanupError);
    }
    throw error;
  }
  await handle.close();
}
