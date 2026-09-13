import { forwardRef, useCallback, type Ref } from "react";
import { TextInput } from "react-native";
import PasteInput, {
  type PastedFile,
  type PasteTextInputInstance,
} from "@mattermost/react-native-paste-input";
import type { ComposerTextInputProps } from "./composer-text-input.types";

export const ComposerTextInput = forwardRef<TextInput, ComposerTextInputProps>(
  function ComposerTextInput(
    { onPasteImages, onPasteError, pasteImagesEnabled = true, ...props },
    ref,
  ) {
    const onPaste = useCallback(
      (error: string | null | undefined, files: PastedFile[]) => {
        if (!pasteImagesEnabled || props.editable === false) return;
        if (error) {
          onPasteError?.();
        } else if (files.length > 0) {
          onPasteImages?.(files);
        }
      },
      [onPasteImages, onPasteError, pasteImagesEnabled, props.editable],
    );
    if (!onPasteImages && !onPasteError) return <TextInput {...props} ref={ref} />;
    // PasteInput implements the RN focus/blur/selection/native-ref contract on both
    // platforms. Keep Otto's controlled value and replacement-key remount outside it.
    return <PasteInput {...props} ref={ref as Ref<PasteTextInputInstance>} onPaste={onPaste} />;
  },
);
