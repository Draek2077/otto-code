import { useMemo, type ComponentType, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { ComposerTrackTransition } from "@/composer/track-transition";
import { X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  toneIconColor,
  toneStyles,
  toneSurface,
  toneText,
  type FlyoutTone,
} from "@/styles/status-tone";

// The composer's tinted fly-out: a band that emerges from the top of the message
// box, tucked behind it so only its top edge shows. Geometry lives here once;
// color is entirely `tone`, so a caller switches the whole band by naming one.
//
// Callers own WHEN to show it and WHAT it says. They never name a color value.

const ThemedIcon = withUnistyles(
  ({ Icon, color, size }: { Icon: FlyoutIcon; color?: string; size: number }) => (
    <Icon size={size} color={color ?? "transparent"} />
  ),
);

type FlyoutIcon = ComponentType<{ size: number; color: string }>;

export interface FlyoutBandProps {
  /** Which color the band wears. The only knob that changes its look. */
  tone: FlyoutTone;
  /** Paint layer in the composer fan, from COMPOSER_TRACK_LAYERS. */
  layer: number;
  message: string;
  /** Leading status icon, tinted to the tone. */
  icon: FlyoutIcon;
  /** Omit to render a band with no dismiss affordance. */
  onDismiss?: () => void;
  dismissLabel?: string;
  testID?: string;
  messageTestID?: string;
  dismissTestID?: string;
}

export function FlyoutBand({
  tone,
  layer,
  message,
  icon,
  onDismiss,
  dismissLabel,
  testID,
  messageTestID,
  dismissTestID,
}: FlyoutBandProps): ReactElement {
  const iconColor = useMemo(() => toneIconColor(tone), [tone]);
  const surfaceStyle = useMemo(() => [styles.surface, toneStyles[toneSurface(tone)]], [tone]);
  const messageStyle = useMemo(() => [styles.message, toneStyles[toneText(tone)]], [tone]);
  return (
    <ComposerTrackTransition layer={layer}>
      <View style={styles.outer} testID={testID}>
        <ChatWidthBounds style={styles.track}>
          <View style={surfaceStyle}>
            <View style={styles.icon}>
              <ThemedIcon Icon={icon} size={14} uniProps={iconColor} />
            </View>
            <Text style={messageStyle} testID={messageTestID}>
              {message}
            </Text>
            {onDismiss ? (
              <BandDismissButton
                iconColor={iconColor}
                label={dismissLabel}
                onDismiss={onDismiss}
                testID={dismissTestID}
              />
            ) : null}
          </View>
        </ChatWidthBounds>
      </View>
    </ComposerTrackTransition>
  );
}

function BandDismissButton({
  iconColor,
  label,
  onDismiss,
  testID,
}: {
  iconColor: ReturnType<typeof toneIconColor>;
  label: string | undefined;
  onDismiss: () => void;
  testID: string | undefined;
}): ReactElement {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
          onPress={onDismiss}
          style={styles.dismissButton}
          hitSlop={8}
        >
          {/* X matches the message color, same tone. */}
          <ThemedIcon Icon={X} size={14} uniProps={iconColor} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    marginBottom: -theme.spacing[4],
  },
  // Color arrives from the tone stylesheet; everything here is shape.
  surface: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    // The band tucks -spacing[4] into the composer; pad the bottom so the text
    // clears the overlap (matches the subagents track's collapsed header).
    paddingBottom: theme.spacing[6],
  },
  icon: {
    flexShrink: 0,
  },
  message: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
  },
  dismissButton: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
