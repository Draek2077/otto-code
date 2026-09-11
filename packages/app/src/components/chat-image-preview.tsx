import { useCallback, useState, type ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { AttachmentLightbox } from "@/components/attachment-lightbox";

/** The thumbnail stays mounted while its lightbox borrows the resolved image URI. */
export function ChatImagePreview({
  uri,
  style,
  children,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("composer.attachments.openImage")}
        onPress={handleOpen}
        style={style}
      >
        {children}
      </Pressable>
      {open ? <AttachmentLightbox metadata={null} uri={uri} onClose={handleClose} /> : null}
    </>
  );
}
