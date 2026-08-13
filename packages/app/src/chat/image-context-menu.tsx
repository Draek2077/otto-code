import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { AttachmentMetadata } from "@/attachments/types";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { copyChatImage, saveChatImage } from "./image-actions";
import { useChatContextMenuTarget } from "./context-menu";

interface ChatImageContextMenuTargetProps {
  attachment: AttachmentMetadata;
  previewUrl: string | null;
  children: ReactNode;
}

/** Supplies image actions to the chat-owned context menu when original bytes exist. */
export function ChatImageContextMenuTarget({
  attachment,
  previewUrl,
  children,
}: ChatImageContextMenuTargetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const chatContextMenu = useChatContextMenuTarget();
  const handleCopy = useCallback(() => {
    void copyChatImage(attachment)
      .then(() => toast.copied(t("message.actions.copyImage")))
      .catch(() => toast.error(t("message.attachments.copyImageFailed")));
  }, [attachment, t, toast]);
  const handleSave = useCallback(() => {
    if (!previewUrl) {
      toast.error(t("message.attachments.imagePreviewUnavailable"));
      return;
    }
    void saveChatImage({ attachment, previewUrl }).catch(() =>
      toast.error(t("message.attachments.saveImageFailed")),
    );
  }, [attachment, previewUrl, t, toast]);
  const handleContextMenu = useCallback(
    (event: unknown) => {
      chatContextMenu?.openTarget(
        event,
        <>
          <ContextMenuItem onSelect={handleCopy} testID="chat-image-copy">
            {t("message.actions.copyImage")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleSave} testID="chat-image-save">
            {t("message.actions.saveImage")}
          </ContextMenuItem>
        </>,
      );
    },
    [chatContextMenu, handleCopy, handleSave, t],
  );

  return (
    <View
      // @ts-expect-error - onContextMenu is web-only and not in RN types.
      onContextMenu={handleContextMenu}
    >
      {children}
    </View>
  );
}
