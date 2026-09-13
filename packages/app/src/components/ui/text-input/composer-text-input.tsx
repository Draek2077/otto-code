import { forwardRef } from "react";
import { TextInput } from "react-native";
import type { ComposerTextInputProps } from "./composer-text-input.types";

// Web image paste stays with the composer's DOM listener; never attach a second handler.
export const ComposerTextInput = forwardRef<TextInput, ComposerTextInputProps>(
  function ComposerTextInput(
    { onPasteImages: _images, onPasteError: _error, pasteImagesEnabled: _enabled, ...props },
    ref,
  ) {
    return <TextInput {...props} ref={ref} />;
  },
);
