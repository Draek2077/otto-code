import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettledMessageSpeech } from "./message-button";

/** OTTO(speech): restore only the left-hand prose bubble and its inset action.
 * Paseo still owns Markdown, reveal, stream grouping, measurements and spacing.
 */
export function AssistantSpeechBubble({
  children,
  message,
  itemId,
  settled,
  spacing,
}: {
  children: ReactNode;
  message: string;
  itemId: string | undefined;
  settled: boolean;
  spacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
}) {
  const [hovered, setHovered] = useState(false);
  const compact = useIsCompactFormFactor();
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const bubbleStyle = useMemo(
    () => [
      styles.bubble,
      (spacing === "compactTop" || spacing === "compactBoth") && styles.continuationTop,
      (spacing === "compactBottom" || spacing === "compactBoth") && styles.continuationBottom,
    ],
    [spacing],
  );
  return (
    <View
      testID="otto-assistant-bubble"
      style={bubbleStyle}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      {children}
      <SettledMessageSpeech
        message={message}
        itemId={itemId}
        settled={settled}
        visible={hovered || isNative || compact}
        dimmed={!hovered && (isNative || compact)}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bubble: {
    position: "relative",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius["2xl"],
    borderTopLeftRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    // The last Markdown block already supplies the bottom inset, as in Otto 0.9.
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  continuationTop: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    alignSelf: "stretch",
  },
  continuationBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: theme.spacing[3],
    alignSelf: "stretch",
  },
}));
