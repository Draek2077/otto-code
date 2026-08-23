import { useCallback, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { VoiceSelection, VoiceSelectionOff } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { StatusPulseGlow, notifyHaloColor } from "@/components/status-pulse-glow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIconSize, type Theme } from "@/styles/theme";
import {
  getWakeWordStatus,
  subscribeWakeWordStatus,
  type WakeWordState,
} from "@/wake-word/wake-word-listening";
import { getWakeWordCapability } from "@/wake-word/wake-word-capability";
import { getWakeWordIconKind } from "./wake-word-icon";
import { getWakeWordLabel } from "./wake-word-label";
import {
  getWakeWordToolbarDisplayState,
  shouldShowWakeWordToolbarButton,
  shouldStartWakeWordListening,
} from "./wake-word-control-state";

const ThemedVoiceSelection = withUnistyles(VoiceSelection);
const ThemedVoiceSelectionOff = withUnistyles(VoiceSelectionOff);
// Theme as a value, not a style: the sanctioned `uniProps` route, see
// docs/unistyles.md.
const statusHaloThemeMapping = (theme: Theme) => ({ theme });

function stateColor(state: WakeWordState) {
  return (theme: Theme) => {
    let color = theme.colors.foregroundMuted;
    if (state === "error" || state === "recording") color = theme.colors.statusDanger;
    if (state === "processing") color = theme.colors.statusWarning;
    if (state === "listening") color = theme.colors.statusSuccess;
    return { color };
  };
}

function WakeWordIcon({ state, size }: { state: WakeWordState; size: number }) {
  return <ThemedWakeWordGlyph state={state} size={size} uniProps={statusHaloThemeMapping} />;
}

// Glyph and halo resolve from one theme pass, as in status-bucket-icon.tsx.
// stateColor already answers green for listening, amber for processing, and red
// for error or recording, so handing its answer to notifyHaloColor glows those
// three and leaves the muted idle state alone.
function WakeWordGlyph({
  state,
  size,
  theme,
}: {
  state: WakeWordState;
  size: number;
  theme: Theme;
}): ReactElement {
  const colorMapping = stateColor(state);
  return (
    <StatusPulseGlow color={notifyHaloColor(theme, colorMapping(theme).color)} size={size}>
      {getWakeWordIconKind(state) === "muted" ? (
        <ThemedVoiceSelectionOff size={size} uniProps={colorMapping} />
      ) : (
        <ThemedVoiceSelection size={size} uniProps={colorMapping} />
      )}
    </StatusPulseGlow>
  );
}

const ThemedWakeWordGlyph = withUnistyles(WakeWordGlyph);

/** Quick listening pause for Hey Otto. The Settings switch owns whether the
 * feature exists at all; this button only stops or resumes the detector while
 * leaving the feature configured and the button available. */
export function WorkspaceWakeWordButton() {
  const { settings, updateSettings } = useAppSettings();
  const isCompact = useIsCompactFormFactor();
  const detectorState = useSyncExternalStore(
    subscribeWakeWordStatus,
    getWakeWordStatus,
    getWakeWordStatus,
  );
  const iconSize = useIconSize(1.5);
  // Compact matches the Chat / Meetings / Visualizer / Brain glyphs beside it
  // (lg); desktop stays on the smaller md glyph shared with the "..." trigger.
  const size = isCompact ? iconSize.lg : iconSize.md;
  const featureEnabled = settings.wakeWordEnabled;
  const listeningPaused = settings.wakeWordListeningPaused;
  const supported = getWakeWordCapability().available;
  // This header toggle reflects the globally-armed state, not any one pane's
  // listener, so it always evaluates as if the pane were focused.
  const listeningEnabled = shouldStartWakeWordListening({
    featureEnabled,
    listeningPaused,
    isPaneFocused: true,
  });
  const visible = shouldShowWakeWordToolbarButton({
    featureEnabled,
    supported,
    hasDictationTab: true,
  });
  const displayedState = getWakeWordToolbarDisplayState({ listeningPaused, detectorState });
  const label = getWakeWordLabel({
    detectorState,
    displayedState,
    listeningPaused,
  });
  const onPress = useCallback(() => {
    void updateSettings({ wakeWordListeningPaused: !listeningPaused });
  }, [listeningPaused, updateSettings]);
  const triggerStyle = useMemo(
    () =>
      ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
        isCompact && headerIconSlotStyle.compactSlot,
        !isCompact && headerIconSlotStyle.slot,
        listeningEnabled && headerIconSlotStyle.slotActive,
        (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
      ],
    [isCompact, listeningEnabled],
  );

  if (!visible) return null;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-wake-word-button"
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <WakeWordIcon state={displayedState} size={size} />
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
const MENU_LISTENING_ICON = <ThemedVoiceSelection uniProps={mutedMenuMapping} />;
const MENU_PAUSED_ICON = <ThemedVoiceSelectionOff uniProps={mutedMenuMapping} />;

/** "..." menu fallback for when the compact header fit drops the button (see
 * `resolveCompactHeaderActions`): the same listening toggle, one tap deeper.
 * Self-gating on the same availability rule as the button, so a host without a
 * usable microphone gets neither. */
export function WorkspaceWakeWordMenuItem() {
  const { settings, updateSettings } = useAppSettings();
  const listeningPaused = settings.wakeWordListeningPaused;
  const visible = shouldShowWakeWordToolbarButton({
    featureEnabled: settings.wakeWordEnabled,
    supported: getWakeWordCapability().available,
    hasDictationTab: true,
  });
  const onSelect = useCallback(() => {
    void updateSettings({ wakeWordListeningPaused: !listeningPaused });
  }, [listeningPaused, updateSettings]);

  if (!visible) return null;

  return (
    <DropdownMenuItem
      testID="workspace-header-wake-word"
      leading={listeningPaused ? MENU_PAUSED_ICON : MENU_LISTENING_ICON}
      onSelect={onSelect}
    >
      {listeningPaused ? "Resume Hey Otto" : "Pause Hey Otto"}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
}));
