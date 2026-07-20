import { forwardRef } from "react";
import { TextInput } from "react-native";
import type { ReactNode } from "react";
import type { TextInputProps } from "react-native";

export type TextAreaProps = TextInputProps;

/**
 * Wraps a multi-line field so it scrolls with the app's own overlay scrollbar
 * instead of the browser's. Native is a pass-through: the OS already draws a
 * transient, self-hiding scroll indicator inside the field. See
 * `text-area.web.tsx` for the web implementation and the reasoning.
 *
 * Reach for this when the field is a specialised input component
 * (`AdaptiveTextInput`, `FormTextInput`, …) that can't simply be swapped for
 * `TextArea` below.
 */
export function TextAreaScrollFrame({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/**
 * Multi-line text field with the app's scrollbar treatment already applied.
 *
 * Use this instead of `<TextInput multiline />` anywhere the field can overflow
 * (prompt boxes, script bodies, descriptions), so every large text box in the
 * app scrolls the same way. `multiline` and top-aligned text are built in.
 */
export const TextArea = forwardRef<TextInput, TextAreaProps>(function TextArea(props, ref) {
  return (
    <TextAreaScrollFrame>
      <TextInput ref={ref} multiline textAlignVertical="top" {...props} />
    </TextAreaScrollFrame>
  );
});
