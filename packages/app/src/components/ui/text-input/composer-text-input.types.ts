import type { TextInputProps } from "react-native";
import type { NativePastedFile } from "@/composer/native-pasted-image";

/** The Otto composer remains controlled; only its native paste transport varies. */
export interface ComposerTextInputProps extends TextInputProps {
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  onPasteError?: () => void;
  pasteImagesEnabled?: boolean;
}
