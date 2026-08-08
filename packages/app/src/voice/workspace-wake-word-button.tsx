import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Mic, MicOff, MicVocal } from "@/components/icons/material-icons";
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

const ThemedMic = withUnistyles(Mic);
const ThemedMicOff = withUnistyles(MicOff);
const ThemedMicVocal = withUnistyles(MicVocal);
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
  if (icon === "muted") return <ThemedMicOff size={size} uniProps={stateColor(state)} />;
  if (icon === "recording") return <ThemedMicVocal size={size} uniProps={stateColor(state)} />;
  return <ThemedMic size={size} uniProps={stateColor(state)} />;
}

/** The workspace control reports status and opens its configuration.
 * Pressing it is the privacy control itself: it immediately disables Hey Otto
 * and lets the listening controller tear down through the settings lifecycle. */
export function WorkspaceWakeWordButton() {
  const { settings, updateSettings } = useAppSettings();
  const isCompact = useIsCompactFormFactor();
  const detectorState = useSyncExternalStore(
    subscribeWakeWordStatus,
    getWakeWordStatus,
    getWakeWordStatus,
  );
  const size = useIconSize(1.5).md;
  const enabled = settings.wakeWordEnabled;
  const supported = getWakeWordCapability().available;
  const label = getWakeWordLabel(detectorState);
  const onPress = useCallback(() => {
    void updateSettings({ wakeWordEnabled: !enabled });
  }, [enabled, updateSettings]);
  const triggerStyle = useMemo(
    () =>
      ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
        isCompact && headerIconSlotStyle.compactSlot,
        !isCompact && headerIconSlotStyle.slot,
        enabled && headerIconSlotStyle.slotActive,
        (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
      ],
    [enabled, isCompact],
  );

  if (!supported || !enabled) return null;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-wake-word-button"
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <WakeWordIcon state={detectorState} size={size} />
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
