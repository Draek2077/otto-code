import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { VoiceSelection, VoiceSelectionOff } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
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
  shouldShowWakeWordToolbarButton,
  shouldStartWakeWordListening,
} from "./wake-word-control-state";

const ThemedVoiceSelection = withUnistyles(VoiceSelection);
const ThemedVoiceSelectionOff = withUnistyles(VoiceSelectionOff);
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
  const icon = getWakeWordIconKind(state);
  if (icon === "muted") {
    return <ThemedVoiceSelectionOff size={size} uniProps={stateColor(state)} />;
  }
  return <ThemedVoiceSelection size={size} uniProps={stateColor(state)} />;
}

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
  const size = useIconSize(1.5).md;
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
  const visible = shouldShowWakeWordToolbarButton({ featureEnabled, supported });
  const displayedState = listeningPaused ? "disabled" : detectorState;
  const label = getWakeWordLabel(displayedState);
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

const styles = StyleSheet.create((theme) => ({
  tooltipText: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
}));
