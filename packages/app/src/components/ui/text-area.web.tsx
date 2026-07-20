import { forwardRef, useCallback, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import type { ReactNode } from "react";
import type { TextInputProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";

export type TextAreaProps = TextInputProps;

const styles = StyleSheet.create((theme) => ({
  // Hugs the field so the overlay can be positioned against its box. No
  // overflow clipping here — the field paints its focus ring outside its own
  // bounds and that ring must stay whole.
  wrapper: {
    position: "relative",
  },
  // Insets the bar off the field's rounded border so it doesn't cut the corner
  // or sit on the border line. `box-none` keeps the wrapper transparent to
  // clicks (they have to reach the field) while the bar keeps its drag area.
  overlay: {
    position: "absolute",
    top: theme.spacing[1],
    right: theme.spacing[1],
    bottom: theme.spacing[1],
    width: theme.spacing[3],
  },
}));

/**
 * Wraps a multi-line field so it scrolls with the app's own overlay scrollbar.
 *
 * A `<textarea>` that overflows paints the browser's chrome scrollbar inside
 * the field — permanently visible, unthemed, and square against the field's
 * rounded border. This swaps it for the same hover-widening, self-hiding bar
 * the panes and dialogs use, so an overflowing text box looks like every other
 * scroll region in the app.
 *
 * The `<textarea>` is found by querying the wrapper rather than by threading a
 * ref through, so this works with any multi-line input component —
 * `AdaptiveTextInput`, `FormTextInput`, a plain `TextInput` — without each one
 * having to forward a host-element ref.
 */
export function TextAreaScrollFrame({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const attachWrapper = useCallback((node: View | null) => {
    // react-native-web renders View as the host div; child refs are attached
    // before the parent's, so the field's element already exists here.
    const host = node as unknown as HTMLElement | null;
    setElement(host?.querySelector("textarea") ?? null);
  }, []);
  // A fresh ref object per element, so the scrollbar hook's effect re-runs and
  // re-binds when the field mounts (or remounts on a `resetKey`).
  const elementRef = useMemo(() => ({ current: element }), [element]);
  const scrollbar = useWebElementScrollbar(elementRef);

  return (
    <View ref={attachWrapper} style={styles.wrapper}>
      {children}
      <View style={styles.overlay} pointerEvents="box-none">
        {scrollbar}
      </View>
    </View>
  );
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
