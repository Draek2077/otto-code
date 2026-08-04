import type { FileReadResult } from "@otto-code/client/internal/daemon-client";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import type { AttachmentMetadata } from "@/attachments/types";
import { isNative } from "@/constants/platform";
import type { WorkspaceImageBase } from "./workspace-image-source";

/**
 * Reading a document's own images through the daemon, once each.
 *
 * The transport is the file-read RPC the viewer already uses for image
 * previews - there is no second image-serving path and there must not be one.
 * `createFilePanePreview` (`components/file-pane.tsx`) is the shape this
 * mirrors: bytes → the attachment store → a `blob:` URL on web, a `file://` one
 * on native, with the store's own lifecycle and GC behind it.
 *
 * Every path handed in here has already been contained by
 * `workspace-image-source.ts`. This module does no path checking of its own and
 * must not be given a path from anywhere else.
 */

export type WorkspaceImageAsset =
  /** Anything `Image` can decode, via the attachment store. */
  | { kind: "attachment"; attachment: AttachmentMetadata }
  /** Native only: `Image` cannot decode SVG, so `SvgXml` gets the raw markup. */
  | { kind: "svg"; xml: string };

export interface WorkspaceImageReader {
  readFile(cwd: string, path: string): Promise<FileReadResult>;
}

/**
 * Past this, the image is not worth the round trip: the read has no size cap of
 * its own (`file-explorer/service.ts` reads whole files), and an oversized one
 * would land in the attachment store as well as in memory. A document that
 * embeds something this big gets its alt text.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Enough for a badge-heavy README several times over. Entries are resolved
 * assets, not React state, so the ceiling is on distinct images seen this
 * session rather than on anything currently mounted.
 */
const MAX_CACHED_IMAGES = 96;

/**
 * Keyed by daemon + workspace + path, so the twenty `<img>`s of a badge table
 * are one read per distinct file however many times they appear, and a remount
 * (tab switch, streaming reflow) costs nothing.
 *
 * The trade this makes: an image edited on disk keeps showing its cached copy
 * until eviction. Documents change far more often than the images they embed,
 * and the alternative - a watch subscription per embedded image - is a lot of
 * machinery for a README logo.
 */
const cache = new Map<string, Promise<WorkspaceImageAsset | null>>();

function cacheKey(base: WorkspaceImageBase, path: string): string {
  return `${base.serverId}\0${base.workspaceRoot}\0${path}`;
}

export function loadWorkspaceImage(input: {
  reader: WorkspaceImageReader;
  base: WorkspaceImageBase;
  /** Workspace-relative, already contained. */
  path: string;
}): Promise<WorkspaceImageAsset | null> {
  const key = cacheKey(input.base, input.path);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const pending = readWorkspaceImage(input).catch((error: unknown) => {
    // A missing or unreadable file is an ordinary outcome for a document that
    // names an image that isn't there; the caller shows alt text either way.
    // Drop the entry so a later mount can retry once the file exists.
    cache.delete(key);
    console.warn("[markdown] Failed to read a workspace image", { path: input.path, error });
    return null;
  });

  cache.set(key, pending);
  while (cache.size > MAX_CACHED_IMAGES) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
  return pending;
}

async function readWorkspaceImage(input: {
  reader: WorkspaceImageReader;
  base: WorkspaceImageBase;
  path: string;
}): Promise<WorkspaceImageAsset | null> {
  const file = await input.reader.readFile(input.base.workspaceRoot, input.path);
  if (file.kind !== "image" || file.bytes.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  if (isNative && file.mime === "image/svg+xml") {
    return { kind: "svg", xml: new TextDecoder().decode(file.bytes) };
  }

  return {
    kind: "attachment",
    attachment: await persistAttachmentFromBytes({
      id: createPreviewAttachmentId({
        mimeType: file.mime,
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt,
        contentLength: file.bytes.byteLength,
      }),
      bytes: file.bytes,
      mimeType: file.mime,
      fileName: getFileNameFromPath(file.path),
    }),
  };
}

/** Test-only: the cache is module state and outlives a single test file. */
export function __clearWorkspaceImageCacheForTests(): void {
  cache.clear();
}
