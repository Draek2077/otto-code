import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettledMessageSpeech } from "./message-button";
import { canFitAssistantProse } from "./bubble-layout";

/** OTTO(speech): restore only the left-hand prose bubble and its inset action.
 * Paseo still owns Markdown, reveal, stream grouping, measurements and spacing.
 */
export function AssistantSpeechBubble({
  children,
  message,
  itemId,
  settled,
}: {
  children: ReactNode;
  message: string;
  itemId: string | undefined;
  settled: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const compact = useIsCompactFormFactor();
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const fitProse = useMemo(() => canFitAssistantProse(message, settled), [message, settled]);
  const bubbleStyle = useMemo(() => [styles.bubble, fitProse && styles.prose], [fitProse]);
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
  prose: { alignSelf: "flex-start" },
  bubble: {
    position: "relative",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius["2xl"],
    borderTopLeftRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[3],
    // Reserve horizontal room for the inset touch target, never another row.
    paddingRight: theme.spacing[12],
    paddingTop: theme.spacing[2],
    // Paseo drops the last Markdown block's gap. Restore Otto's bottom inset
    // on this frame, keeping the playback hitbox inside the rounded bubble.
    paddingBottom: theme.spacing[3],
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
}));
