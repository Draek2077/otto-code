import { useMemo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useChatWidthLayout } from "./chat-width-layout-context";

interface ChatWidthBoundsProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

// ChatWidthLayoutProvider supplies one live width contract to every track.
// Keep its dynamic pixel values inline: Unistyles' web runtime retains a CSS
// class for every distinct value (see docs/unistyles.md "Dynamic Pixel Styles
// On Web").
export function ChatWidthBounds({ style, children }: ChatWidthBoundsProps) {
  const { chatMaxWidth, outlinePadding } = useChatWidthLayout();
  const combinedStyle = useMemo(
    () => [
      style,
      inlineUnistylesStyle({
        maxWidth: chatMaxWidth,
      }),
    ],
    [chatMaxWidth, style],
  );
  // The rail needs clearance around the content, never a unilateral nudge.
  // Keeping this symmetric preserves the lane's centered left/right gutters
  // and gives the composer the exact same geometry as transcript rows.
  const contentInsetStyle = useMemo(
    () => inlineUnistylesStyle({ paddingHorizontal: outlinePadding }),
    [outlinePadding],
  );
  return (
    <View style={combinedStyle}>
      <View style={contentInsetStyle}>{children}</View>
    </View>
  );
}
