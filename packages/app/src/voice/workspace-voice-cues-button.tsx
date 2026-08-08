import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RecordVoiceOver, VoiceOverOff } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
// `accentBright` - the same accent the Sidebar and Explorer toggles use for their
// on-state, so every enabled header toggle reads as one family.
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

// Accent while cues can speak, so the button reads as the state toggle it is -
// same convention as the Visualizer button beside it.
function resolveGlyphColor(input: { unmuted: boolean; hovered: boolean }) {
  if (input.unmuted) {
    return accentColorMapping;
  }
  return input.hovered ? foregroundColorMapping : mutedColorMapping;
}

// Same slot chrome as the neighboring Visualizer button and "..." menu trigger,
// held while cues are unmuted so the on-state is visible without a hover.
function resolveTriggerStyle(unmuted: boolean, isCompact: boolean) {
  return ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
    isCompact && headerIconSlotStyle.compactSlot,
    !isCompact && headerIconSlotStyle.slot,
    unmuted && headerIconSlotStyle.slotActive,
    (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
  ];
}

/** Whether a cue mute is worth a header slot: the host can speak cues (the same
 * capability pair the playback hook gates on) AND the user has the feature
 * enabled. A mute for something that can never make noise is just clutter - so
 * turning cues off in settings takes the button away with them, and turning
 * them back on brings it back. Muting is not disabling: a muted button stays. */
export function useVoiceCuesAvailable(serverId: string): boolean {
  const canAuthorCues = useVisualizerVoiceCuesFeature(serverId);
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  const { settings } = useAppSettings();
  return canAuthorCues && canPreviewVoice && settings.agentVoiceCues;
}

/** Quick mute for agent voice cues, in the workspace header's title cluster,
 * immediately left of the Visualizer button.
 *
 * Cues are a notification channel that fires while you are looking at something
 * else, so the moment you need to silence them is rarely the moment you want to
 * open Settings.
 *
 * This is a MUTE, which is not the same thing as the Agents settings toggle.
 * That toggle is "do I want cues at all"; this is "not right now" - exactly the
 * split the Visualizer already has between its feature switch and its in-page
 * speaker button. So this writes `agentVoiceCuesMuted`, never `agentVoiceCues`:
 * muting leaves the feature configured (and this button on screen, showing its
 * muted glyph), while disabling cues in settings removes the button altogether,
 * because a mute for something switched off is a control over nothing.
 *
 * The caller owns both gates - availability and the responsive drop-off - via
 * `useVoiceCuesAvailable` and `resolveCompactHeaderActions`. */
export function WorkspaceVoiceCuesButton() {
  const isCompact = useIsCompactFormFactor();
  const iconSize = useIconSize(1.5);
  // Compact matches the Play/Explorer/Visualizer glyphs beside it (lg), desktop
  // stays at the smaller md glyph shared with the "..." trigger.
  const glyphSize = isCompact ? iconSize.lg : iconSize.md;
  const { settings, updateSettings } = useAppSettings();
  const unmuted = !settings.agentVoiceCuesMuted;

  const label = unmuted ? "Mute voice cues" : "Unmute voice cues";
  const onPress = useCallback(() => {
    void updateSettings({ agentVoiceCuesMuted: unmuted });
  }, [unmuted, updateSettings]);
  const Glyph = unmuted ? ThemedRecordVoiceOver : ThemedVoiceOverOff;
  const triggerStyle = useMemo(() => resolveTriggerStyle(unmuted, isCompact), [isCompact, unmuted]);

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
            uniProps={resolveGlyphColor({ unmuted, hovered: Boolean(hovered) })}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

// Matches the workspace "..." menu's leading-icon convention (muted, md).
const mutedMenuMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const MENU_UNMUTED_ICON = <ThemedRecordVoiceOver uniProps={mutedMenuMapping} />;
const MENU_MUTED_ICON = <ThemedVoiceOverOff uniProps={mutedMenuMapping} />;

/** "..." menu fallback for when the compact header fit drops the button (see
 * `resolveCompactHeaderActions`): the same mute toggle, one tap deeper. */
export function WorkspaceVoiceCuesMenuItem() {
  const { settings, updateSettings } = useAppSettings();
  const unmuted = !settings.agentVoiceCuesMuted;

  const onSelect = useCallback(() => {
    void updateSettings({ agentVoiceCuesMuted: unmuted });
  }, [unmuted, updateSettings]);

  return (
    <DropdownMenuItem
      testID="workspace-header-voice-cues"
      leading={unmuted ? MENU_UNMUTED_ICON : MENU_MUTED_ICON}
      onSelect={onSelect}
    >
      {unmuted ? "Mute voice cues" : "Unmute voice cues"}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
