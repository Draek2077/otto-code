import { useMemo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

interface ChatWidthBoundsProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

// `theme.layout.chatMaxWidth` is a high-churn dynamic pixel value (the user's
// chat-width setting). Unistyles' web runtime hashes each distinct maxWidth
// into its own CSS class; switching between two already-seen values can leave
// the DOM element pointed at the previous class for a render (see
// docs/unistyles.md "Dynamic Pixel Styles On Web"). Isolate the sanctioned
// `useUnistyles()` escape hatch to this one leaf and apply the value as a
// genuine inline style instead of baking it into a themed stylesheet class.
export function ChatWidthBounds({ style, children }: ChatWidthBoundsProps) {
  const { theme } = useUnistyles();
  const combinedStyle = useMemo(
    () => [style, inlineUnistylesStyle({ maxWidth: theme.layout.chatMaxWidth })],
    [style, theme.layout.chatMaxWidth],
  );
  return <View style={combinedStyle}>{children}</View>;
}
