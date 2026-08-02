import { useCallback, type RefObject } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useBinaryFileWriteFeature } from "@/file-explorer/use-binary-file-write-feature";
import type { EditorController, EditorDroppedImage } from "../editor-contract";
import {
  buildImageAssetTarget,
  buildImageInsert,
  suffixImageAssetPath,
} from "./markdown-image-drop";
import { isMarkdownPath } from "./markdown-path";

/**
 * The host half of markdown image paste and drop: write the bytes into the
 * workspace, then insert the relative `![](...)` at the caret.
 *
 * The editor cannot do either. It has no daemon connection on native (it runs
 * in a webview) and no filesystem on any platform, so it recognises the image
 * and hands it here — see `markdownImageDropHandler`.
 *
 * Returning `undefined` is the capability gate, and the only one: no handler
 * means the core registers no drop extension at all, so a daemon without
 * `features.binaryFileWrite` leaves a dropped image to the platform rather than
 * swallowing it into a feature that cannot finish. There is deliberately no
 * degraded path — the client cannot write a workspace file itself.
 */

/**
 * How many names to try before giving up. The daemon never clobbers, so a taken
 * name comes back as `exists` and we try `x-2.png`, `x-3.png`. A handful is
 * plenty for a folder of pasted screenshots and stops a pathological directory
 * from turning one drop into hundreds of round trips.
 */
const MAX_NAME_ATTEMPTS = 20;

export function useMarkdownImageDrop(input: {
  serverId: string;
  workspaceRoot: string;
  /** The document being edited, workspace-relative. */
  path: string;
  controllerRef: RefObject<EditorController | null>;
}): ((images: readonly EditorDroppedImage[]) => void) | undefined {
  const client = useSessionStore((state) => state.sessions[input.serverId]?.client ?? null);
  const canWriteBinary = useBinaryFileWriteFeature(input.serverId);
  const { workspaceRoot, path, controllerRef } = input;

  const handleImageDrop = useCallback(
    (images: readonly EditorDroppedImage[]) => {
      if (!client) {
        return;
      }
      void (async () => {
        // Sequential, not `Promise.all`: each insert goes in at the caret, and
        // the caret only lands after the previous one has been inserted. Racing
        // the writes would interleave the links in an arbitrary order.
        for (const [index, image] of images.entries()) {
          const target = buildImageAssetTarget({
            documentPath: path,
            image: { name: image.name, mimeType: image.mimeType },
            now: new Date(),
            index,
          });
          if (!target) {
            continue;
          }

          const written = await writeWithFreeName({
            write: (candidate) =>
              // No `overwrite`: a drop must never destroy a file that is
              // already there. The daemon creates the `assets/` parent itself.
              client.writeBinaryFile({
                cwd: workspaceRoot,
                path: candidate,
                contentBase64: image.dataBase64,
              }),
            path: target.path,
          });
          if (!written) {
            continue;
          }

          // Rebuilt rather than reusing `target.insert`, because the name that
          // was free may not be the name we asked for.
          controllerRef.current?.replaceSelection(buildImageInsert(path, written));
        }
      })();
    },
    [client, controllerRef, path, workspaceRoot],
  );

  // The gate. `isMarkdownPath` too, so a `.ts` buffer never carries a handler
  // whose CM6 half would decline anyway — one less extension in every other file.
  return canWriteBinary && client && isMarkdownPath(path) ? handleImageDrop : undefined;
}

/**
 * Write to the first free name, or null when every attempt was taken and when
 * the write failed outright.
 *
 * A failure is deliberately silent. The drop either produces a link or it does
 * not, and there is no surface here that could report "the daemon refused this
 * path" without inventing an error affordance the editor does not have — the
 * user sees no link appear, and their document is untouched.
 */
async function writeWithFreeName(input: {
  write: (path: string) => Promise<{ status: string }>;
  path: string;
}): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? input.path : suffixImageAssetPath(input.path, attempt);
    try {
      const result = await input.write(candidate);
      if (result.status === "written") {
        return candidate;
      }
      if (result.status !== "exists") {
        return null;
      }
    } catch {
      return null;
    }
  }
  return null;
}
