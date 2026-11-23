import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import { Ear, EarOff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useWakePreferences } from "./use-preferences";
import { useWakeCapability } from "./use-capability";
import { getWakeStatus, subscribeWakeStatus } from "./status";
const ActiveIcon = withUnistyles(Ear),
  PausedIcon = withUnistyles(EarOff);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const tones = {
  disabled: muted,
  paused: muted,
  starting: (theme: Theme) => ({ color: theme.colors.statusWarning }),
  listening: (theme: Theme) => ({ color: theme.colors.statusSuccess }),
  recording: (theme: Theme) => ({ color: theme.colors.statusDanger }),
  processing: (theme: Theme) => ({ color: theme.colors.statusWarning }),
  error: (theme: Theme) => ({ color: theme.colors.statusDanger }),
};
export function WakeWordButton({ active }: { active: boolean }) {
  const capability = useWakeCapability();
  const { settings, save } = useWakePreferences();
  const status = useSyncExternalStore(subscribeWakeStatus, getWakeStatus);
  const toggle = useCallback(
    () => save({ wakeWordListeningPaused: !settings.wakeWordListeningPaused }),
    [save, settings.wakeWordListeningPaused],
  );
  if (!active || !capability.available || !settings.wakeWordEnabled) return null;
  const paused = settings.wakeWordListeningPaused;
  const label = paused ? "Resume Hey Otto listening" : `Pause Hey Otto listening (${status.state})`;
  return (
    <ToolbarButton
      label={label}
      tooltip={status.error || label}
      selected={!paused}
      onPress={toggle}
    >
      {paused ? (
        <PausedIcon size={16} uniProps={muted} />
      ) : (
        <ActiveIcon size={16} uniProps={tones[status.state]} />
      )}
    </ToolbarButton>
  );
}
export function WakeWordGutter({ children }: { children: ReactNode }) {
  return (
    <View style={styles.gutter}>
      <WakeWordButton active />
      {children}
    </View>
  );
}
const styles = StyleSheet.create({ gutter: { flexDirection: "row", alignItems: "center" } });
