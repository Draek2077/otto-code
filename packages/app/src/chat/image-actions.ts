import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import type { AttachmentMetadata } from "@/attachments/types";
import { getAttachmentStore } from "@/attachments/store";
import { isWeb } from "@/constants/platform";

function fallbackFileName(attachment: AttachmentMetadata): string {
  return attachment.fileName?.trim() || `image-${attachment.id}`;
}

/** Copies the original attachment bytes, not its resized chat preview. */
export async function copyChatImage(attachment: AttachmentMetadata): Promise<void> {
  const store = await getAttachmentStore();
  const base64 = await store.encodeBase64({ attachment });
  await Clipboard.setImageAsync(base64);
}

/** Saves through the browser download flow or the native share sheet. */
export async function saveChatImage(input: {
  attachment: AttachmentMetadata;
  previewUrl: string;
}): Promise<void> {
  if (isWeb) {
    const link = document.createElement("a");
    link.href = input.previewUrl;
    link.download = fallbackFileName(input.attachment);
    link.click();
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Image saving is unavailable on this device.");
  }
  await Sharing.shareAsync(input.previewUrl, {
    mimeType: input.attachment.mimeType,
    dialogTitle: fallbackFileName(input.attachment),
  });
}
