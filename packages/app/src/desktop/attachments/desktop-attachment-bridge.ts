import type {
  AttachmentMetadata,
  AttachmentStoreUsage,
  ClearPreviewAttachmentsResult,
} from "@/attachments/types";
import {
  clearDesktopPreviewAttachments,
  copyDesktopAttachmentFile,
  deleteDesktopAttachmentFile,
  garbageCollectDesktopAttachmentFiles,
  readDesktopAttachmentUsage,
  writeDesktopAttachmentBase64,
  writeDesktopAttachmentBytes,
} from "@/desktop/attachments/desktop-file-commands";
import {
  createBrowserObjectUrlMinter,
  createDesktopFileReader,
  createDesktopPreviewUrlResolver,
  readDesktopFileBase64,
} from "@/desktop/attachments/desktop-preview-url";

export interface DesktopAttachmentFileResult {
  path: string;
  byteSize: number;
}

export interface DesktopAttachmentBridge {
  copyFile(input: {
    attachmentId: string;
    sourcePath: string;
    extension?: string | null;
  }): Promise<DesktopAttachmentFileResult>;
  writeBase64(input: {
    attachmentId: string;
    base64: string;
    extension?: string | null;
  }): Promise<DesktopAttachmentFileResult>;
  writeBytes(input: {
    attachmentId: string;
    bytes: Uint8Array;
    extension?: string | null;
  }): Promise<DesktopAttachmentFileResult>;
  deleteFile(input: { path: string }): Promise<boolean>;
  garbageCollect(input: { referencedIds: readonly string[] }): Promise<number>;
  usage(): Promise<AttachmentStoreUsage>;
  clearPreviews(): Promise<ClearPreviewAttachmentsResult>;
  readFileBase64(path: string): Promise<string>;
  resolvePreviewUrl(attachment: AttachmentMetadata): Promise<string>;
  releasePreviewUrl(input: { url: string }): Promise<void>;
}

export function createDesktopAttachmentBridge(): DesktopAttachmentBridge {
  const previewUrls = createDesktopPreviewUrlResolver({
    reader: createDesktopFileReader(),
    objectUrls: createBrowserObjectUrlMinter(),
  });
  return {
    copyFile: copyDesktopAttachmentFile,
    writeBase64: writeDesktopAttachmentBase64,
    writeBytes: writeDesktopAttachmentBytes,
    deleteFile: deleteDesktopAttachmentFile,
    garbageCollect: garbageCollectDesktopAttachmentFiles,
    usage: readDesktopAttachmentUsage,
    clearPreviews: clearDesktopPreviewAttachments,
    readFileBase64: readDesktopFileBase64,
    resolvePreviewUrl: (attachment) => previewUrls.resolve(attachment),
    releasePreviewUrl: (input) => previewUrls.release(input),
  };
}
