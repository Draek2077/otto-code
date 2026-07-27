import type { AttachmentFileSystem } from "@/attachments/attachment-file-system";
import {
  type AttachmentStore,
  type AttachmentStorageType,
  type AttachmentMetadata,
  type AttachmentStoreUsage,
  type ClearPreviewAttachmentsResult,
  type SaveAttachmentInput,
} from "@/attachments/types";
import { isPreviewAttachmentId } from "@/attachments/preview-pins";
import {
  fileUriToPath,
  generateAttachmentId,
  getFileExtensionFromName,
  normalizeMimeType,
  parseDataUrl,
  pathToFileUri,
} from "@/attachments/utils";

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tiff",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

function extensionForAttachment(params: { fileName?: string | null; mimeType: string }): string {
  const fromName = getFileExtensionFromName(params.fileName);
  if (fromName) {
    return fromName;
  }
  return IMAGE_EXTENSION_BY_MIME_TYPE[params.mimeType] ?? ".img";
}

async function ensureDirectory(fileSystem: AttachmentFileSystem, uri: string): Promise<void> {
  const info = await fileSystem.getInfo(uri);
  if (info.exists && info.isDirectory) {
    return;
  }
  await fileSystem.makeDirectory(uri, { intermediates: true });
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const response = await fetch(dataUrl);
  return new Uint8Array(await response.arrayBuffer());
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function writeFromSource(input: {
  fileSystem: AttachmentFileSystem;
  source: SaveAttachmentInput["source"];
  targetUri: string;
  mimeType: string;
}): Promise<void> {
  if (input.source.kind === "file_uri") {
    const from = pathToFileUri(input.source.uri);
    if (from === input.targetUri) {
      return;
    }
    await input.fileSystem.copy({ from, to: input.targetUri });
    return;
  }

  let bytes: Uint8Array;
  if (input.source.kind === "data_url") {
    bytes = await dataUrlToBytes(input.source.dataUrl);
  } else if (input.source.kind === "blob") {
    bytes = await blobToBytes(input.source.blob);
  } else {
    bytes = input.source.bytes;
  }

  await input.fileSystem.writeBytes(input.targetUri, bytes);
}

function attachmentUri(metadata: AttachmentMetadata): string {
  return pathToFileUri(metadata.storageKey);
}

export function createLocalFileAttachmentStore(params: {
  storageType: Extract<AttachmentStorageType, "desktop-file" | "native-file">;
  baseDirectoryName: string;
  fileSystem: AttachmentFileSystem;
  resolvePreviewUrl: (attachment: AttachmentMetadata) => Promise<string>;
  releasePreviewUrl?: (input: { attachment: AttachmentMetadata; url: string }) => Promise<void>;
}): AttachmentStore {
  const { fileSystem } = params;
  const baseDirectory = fileSystem.cacheDirectory
    ? `${fileSystem.cacheDirectory}${params.baseDirectoryName}/`
    : null;

  async function resolveTarget(input: SaveAttachmentInput): Promise<{
    id: string;
    mimeType: string;
    fileName: string | null;
    createdAt: number;
    targetUri: string;
    storageKey: string;
  }> {
    if (!baseDirectory) {
      throw new Error("Attachment file-system cacheDirectory is unavailable.");
    }

    await ensureDirectory(fileSystem, baseDirectory);

    const id = input.id ?? generateAttachmentId();
    let mimeTypeFromSource: string | undefined;
    if (input.source.kind === "data_url") {
      mimeTypeFromSource = parseDataUrl(input.source.dataUrl).mimeType;
    } else if (input.source.kind === "blob") {
      mimeTypeFromSource = input.source.blob.type;
    } else {
      mimeTypeFromSource = undefined;
    }
    const mimeType = normalizeMimeType(input.mimeType ?? mimeTypeFromSource);
    const fileName = input.fileName ?? null;
    const extension = extensionForAttachment({ fileName, mimeType });
    const createdAt = Date.now();
    const targetUri = `${baseDirectory}${id}${extension}`;
    const storageKey = fileUriToPath(targetUri);

    return {
      id,
      mimeType,
      fileName,
      createdAt,
      targetUri,
      storageKey,
    };
  }

  return {
    storageType: params.storageType,

    async save(input): Promise<AttachmentMetadata> {
      const target = await resolveTarget(input);
      await writeFromSource({
        fileSystem,
        source: input.source,
        targetUri: target.targetUri,
        mimeType: target.mimeType,
      });

      const info = await fileSystem.getInfo(target.targetUri);
      const byteSize = info.exists ? info.size : null;
      return {
        id: target.id,
        mimeType: target.mimeType,
        storageType: params.storageType,
        storageKey: target.storageKey,
        fileName: target.fileName,
        byteSize,
        createdAt: target.createdAt,
      };
    },

    async encodeBase64({ attachment }): Promise<string> {
      return await fileSystem.readAsBase64(attachmentUri(attachment));
    },

    async resolvePreviewUrl({ attachment }): Promise<string> {
      return await params.resolvePreviewUrl(attachment);
    },

    ...(params.releasePreviewUrl
      ? {
          async releasePreviewUrl(input: {
            attachment: AttachmentMetadata;
            url: string;
          }): Promise<void> {
            await params.releasePreviewUrl?.(input);
          },
        }
      : {}),

    async delete({ attachment }): Promise<void> {
      await fileSystem.delete(attachmentUri(attachment), { idempotent: true });
    },

    async garbageCollect({ referencedIds }): Promise<void> {
      if (!baseDirectory) {
        return;
      }
      await ensureDirectory(fileSystem, baseDirectory);
      const entries = await fileSystem.listDirectory(baseDirectory);
      await Promise.all(
        entries.map(async (entryName) => {
          const id = entryName.split(".", 1)[0] ?? "";
          if (!id || referencedIds.has(id)) {
            return;
          }
          await fileSystem.delete(`${baseDirectory}${entryName}`, {
            idempotent: true,
          });
        }),
      );
    },

    async usage(): Promise<AttachmentStoreUsage> {
      const usage = { previewCount: 0, previewBytes: 0, otherCount: 0, otherBytes: 0 };
      if (!baseDirectory) {
        return usage;
      }
      await ensureDirectory(fileSystem, baseDirectory);
      const entries = await fileSystem.listDirectory(baseDirectory);
      await Promise.all(
        entries.map(async (entryName) => {
          const info = await fileSystem.getInfo(`${baseDirectory}${entryName}`);
          const size = info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
          if (isPreviewAttachmentId(entryName.split(".", 1)[0] ?? "")) {
            usage.previewCount += 1;
            usage.previewBytes += size;
          } else {
            usage.otherCount += 1;
            usage.otherBytes += size;
          }
        }),
      );
      return usage;
    },

    async clearPreviews(): Promise<ClearPreviewAttachmentsResult> {
      if (!baseDirectory) {
        return { deleted: 0, freedBytes: 0 };
      }
      await ensureDirectory(fileSystem, baseDirectory);
      const entries = await fileSystem.listDirectory(baseDirectory);
      const previews = entries.filter((entryName) =>
        isPreviewAttachmentId(entryName.split(".", 1)[0] ?? ""),
      );

      let deleted = 0;
      let freedBytes = 0;
      await Promise.all(
        previews.map(async (entryName) => {
          const uri = `${baseDirectory}${entryName}`;
          const info = await fileSystem.getInfo(uri);
          await fileSystem.delete(uri, { idempotent: true });
          deleted += 1;
          freedBytes += info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
        }),
      );
      return { deleted, freedBytes };
    },
  };
}
