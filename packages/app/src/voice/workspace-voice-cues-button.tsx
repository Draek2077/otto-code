import { useCallback } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RecordVoiceOver, VoiceOverOff } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerVoiceCuesFeature } from "@/screens/settings/agent-personalities-section";
import { useTtsPreviewFeature } from "@/screens/settings/voice-preview-button";
import { useIconSize, type Theme } from "@/styles/theme";

const ThemedRecordVoiceOver = withUnistyles(RecordVoiceOver);
const ThemedVoiceOverOff = withUnistyles(VoiceOverOff);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.primary });

// Accent while cues can speak, so the button reads as the state toggle it is —
// same convention as the Visualizer button beside it.
function resolveGlyphColor(input: { speaking: boolean; hovered: boolean }) {
  if (input.speaking) {
    return accentColorMapping;
  }
  return input.hovered ? foregroundColorMapping : mutedColorMapping;
}

// Same slot chrome as the neighboring Visualizer button and "..." menu trigger.
function triggerStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [
    headerIconSlotStyle.slot,
    (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
  ];
}

/** Whether this host can actually speak cues — the same capability pair the
 * playback hook gates on. A mute for something that can never make noise is
 * just clutter, so the header button is only worth a slot when both are there. */
export function useVoiceCuesAvailable(serverId: string): boolean {
  const canAuthorCues = useVisualizerVoiceCuesFeature(serverId);
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  return canAuthorCues && canPreviewVoice;
}

/** Quick mute for agent voice cues, in the workspace header's title cluster,
 * immediately left of the Visualizer button.
 *
 * Cues are a notification channel that fires while you are looking at something
 * else, so the moment you need to silence them is rarely the moment you want to
 * open Settings. This is the same `agentVoiceCues` switch as the Agents settings
 * row — one boolean, two places to flip it — not a separate transient mute, so
 * the state survives a restart and the two surfaces can never disagree.
 *
 * Rendered only when the host can actually speak cues; the caller owns that gate
 * (and the responsive drop-off) via `resolveCompactHeaderActions`. */
export function WorkspaceVoiceCuesButton() {
  const isCompact = useIsCompactFormFactor();
  const iconSize = useIconSize(1.5);
  // Compact matches the Play/Explorer/Visualizer glyphs beside it (lg), desktop
  // stays at the smaller md glyph shared with the "..." trigger.
  const glyphSize = isCompact ? iconSize.lg : iconSize.md;
  const { settings, updateSettings } = useAppSettings();
  const speaking = settings.agentVoiceCues;

  const label = speaking ? "Mute voice cues" : "Unmute voice cues";
  const onPress = useCallback(() => {
    void updateSettings({ agentVoiceCues: !speaking });
  }, [speaking, updateSettings]);
  const Glyph = speaking ? ThemedRecordVoiceOver : ThemedVoiceOverOff;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-voice-cues-button"
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {({ hovered }: { hovered?: boolean }) => (
          <Glyph
            size={glyphSize}
            uniProps={resolveGlyphColor({ speaking, hovered: Boolean(hovered) })}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
