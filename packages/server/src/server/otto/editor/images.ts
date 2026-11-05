import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { z } from "zod";
import { writeEditorImage } from "@getpaseo/plugin/otto/editor";
import {
  buildImageAssetTarget,
  buildImageInsert,
  suffixImageAssetPath,
} from "@getpaseo/plugin/otto/editor-images";
import { canonicalDocument, isInside } from "./lsp/uri.js";
import { EditorError } from "./errors.js";

type Request = z.output<typeof writeEditorImage.input>;
interface Entry {
  fingerprint: string;
  settled: boolean;
  promise: Promise<{ path: string; insert: string }>;
}
/** Bounded idempotency for a paste whose reply was lost. Only created paths are
 * retained, never image bytes or another file/draft representation. */
export class EditorImageWrites {
  private readonly operations = new Map<string, Entry>();
  private active = 0;
  write(clientId: string, request: Request, isCurrent: () => boolean) {
    const key = JSON.stringify([clientId, request.operationId, request.root, request.file]);
    const fingerprint = createHash("sha256").update(JSON.stringify(request.image)).digest("hex");
    const previous = this.operations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new EditorError(
          "conflict",
          "An image paste identity cannot be reused for different bytes.",
        );
      return previous.promise;
    }
    if (this.active >= 4)
      throw new EditorError("unavailable", "Wait for another image paste to finish.");
    if (this.operations.size >= 128) {
      const first = [...this.operations].find(([, entry]) => entry.settled);
      if (first) this.operations.delete(first[0]);
      else throw new EditorError("unavailable", "Wait for pending image pastes to finish.");
    }
    this.active++;
    const entry: Entry = {
      fingerprint,
      settled: false,
      promise: writeImage(request, isCurrent).finally(() => {
        this.active--;
        entry.settled = true;
      }),
    };
    this.operations.set(key, entry);
    return entry.promise;
  }
}
async function writeImage(request: Request, isCurrent: () => boolean) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      request.image.dataBase64,
    )
  )
    throw new EditorError("invalid", "The pasted image could not be decoded.");
  const bytes = Buffer.from(request.image.dataBase64, "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new EditorError("invalid", "Paste images up to 2 MB each.");
  const document = await canonicalDocument(request.root, request.file);
  const documentPath = path.relative(document.root, document.file).split(path.sep).join("/");
  const target = buildImageAssetTarget({
    documentPath,
    image: request.image,
    now: new Date(),
    index: 0,
  });
  if (!target) throw new EditorError("invalid", "This image type cannot be pasted into Markdown.");
  const parent = path.dirname(path.join(document.root, target.path));
  if (!isCurrent())
    throw new EditorError("closed", "The editor was closed before the paste started.");
  await mkdir(parent, { recursive: true });
  const directory = await realpath(parent);
  if (!isInside(document.root, directory))
    throw new EditorError("invalid", "The image assets directory leaves this workspace.");
  for (let attempt = 1; attempt <= 20; attempt++) {
    if (!isCurrent())
      throw new EditorError("closed", "The editor was closed before the image was written.");
    const relative = attempt === 1 ? target.path : suffixImageAssetPath(target.path, attempt);
    const file = path.join(directory, path.basename(relative));
    const handle = await open(file, "wx").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return null;
      throw error;
    });
    if (!handle) continue;
    await writeCreatedImage(handle, file, bytes);
    return { path: relative, insert: buildImageInsert(documentPath, relative) };
  }
  throw new EditorError("conflict", "The image name is already taken. Choose another filename.");
}
async function writeCreatedImage(handle: FileHandle, file: string, bytes: Buffer) {
  let failed = false,
    primary: unknown;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failed = true;
    primary = error;
  }
  const cleanup: unknown[] = [];
  try {
    await handle.close();
  } catch (error) {
    cleanup.push(error);
  }
  if (failed)
    try {
      await rm(file, { force: true });
    } catch (error) {
      cleanup.push(error);
    }
  if (failed && cleanup.length)
    throw new AggregateError([primary, ...cleanup], "Image write and cleanup failed.", {
      cause: primary,
    });
  if (failed) throw primary;
  if (cleanup.length)
    throw new AggregateError(cleanup, "Image was written, but closing it failed.");
}
