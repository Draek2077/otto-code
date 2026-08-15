import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import type { Theme } from "@/styles/theme";

interface ComposerFrameProps {
  children: ReactNode;
  /** Content that must sit above the bounded composer frame, such as a lightbox portal. */
  renderOverlay?: () => ReactNode;
  /** Content immediately below the composer frame, retaining the composer's seam. */
  footer?: ReactNode;
  isLocked?: boolean;
  /** A parent that already follows the native keyboard owns the translation. */
  externalKeyboardShift?: boolean;
}

/**
 * The neutral physical shell shared by every message composer. It deliberately
 * knows nothing about agents, queues, attachments, or room state: those are
 * content concerns, while the keyboard lift and bounded seam are not.
 */
export function ComposerFrame({
  children,
  renderOverlay,
  footer,
  isLocked = false,
  externalKeyboardShift = false,
}: ComposerFrameProps): ReactElement {
  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({
    mode: "translate",
    enabled: !externalKeyboardShift,
  });

  return (
    <Animated.View style={[styles.container, keyboardAnimatedStyle]}>
      {renderOverlay?.()}
      <View style={[styles.inputAreaContainer, isLocked && styles.inputAreaLocked]}>
        <ChatWidthBounds style={styles.inputAreaContent}>{children}</ChatWidthBounds>
      </View>
      {footer}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    alignItems: "center",
    marginHorizontal: "auto",
    minHeight: FOOTER_HEIGHT,
    overflow: "visible",
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    position: "relative",
    width: "100%",
  },
  inputAreaLocked: {
    opacity: 0.6,
  },
  inputAreaContent: {
    gap: theme.spacing[3],
    width: "100%",
  },
}));
