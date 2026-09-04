import type { AttachmentMetadata } from "@/attachments/types";
import { persistAttachmentFromBlob } from "@/attachments/service";
import { resolveRasterImageMimeType } from "@/attachments/file-types";

export interface ClipboardItemLike {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
}

export interface ClipboardDataLike {
  items?: ArrayLike<ClipboardItemLike> | null;
  files?: ArrayLike<File> | null;
}

export type ImageAttachmentFromFile = AttachmentMetadata;

export interface ClipboardImageFile {
  file: File;
  mimeType: string;
}

export function collectImageFilesFromClipboardData(
  clipboardData?: ClipboardDataLike | null,
): ClipboardImageFile[] {
  const files: ClipboardImageFile[] = [];
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item?.kind !== "file") continue;

    const file = item.getAsFile?.();
    if (!file) continue;

    // Windows clipboard producers do not consistently populate the item's MIME
    // type, even when the File is a valid image. The File is the payload we
    // persist, so it is the authoritative fallback for both type and name.
    const mimeType =
      resolveRasterImageMimeType({ mimeType: item.type }) ??
      resolveRasterImageMimeType({ mimeType: file.type, path: file.name });
    if (!mimeType) continue;

    files.push({ file, mimeType });
  }

  // Some clipboard implementations expose image data only through files. Do
  // not read both lists: Chromium normally exposes the same image in each.
  if (files.length > 0) return files;

  for (const file of Array.from(clipboardData?.files ?? [])) {
    const mimeType = resolveRasterImageMimeType({ mimeType: file.type, path: file.name });
    if (!mimeType) continue;
    files.push({ file, mimeType });
  }

  return files;
}

export async function filesToImageAttachments(
  files: readonly ClipboardImageFile[],
): Promise<ImageAttachmentFromFile[]> {
  const attachments = await Promise.all(
    files.map(async ({ file, mimeType }) => {
      try {
        return await persistAttachmentFromBlob({
          blob: file,
          mimeType,
          fileName: file.name,
        });
      } catch (error) {
        console.error("[attachments] Failed to persist file attachment", {
          fileName: file.name,
          error,
        });
        return null;
      }
    }),
  );

  return attachments.filter((entry): entry is ImageAttachmentFromFile => entry !== null);
}
