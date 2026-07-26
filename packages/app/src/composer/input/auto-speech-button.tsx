// The composer's auto-speech toggle — the only UI for the read-aloud mode.
//
// It sits next to the dictation mic and is deliberately the same 28px round icon
// button, because the two are the same idea pointing opposite ways: the mic
// turns your voice into text, this turns the agent's text into voice. A toggle
// rather than a press-and-hold action, so its state is legible at rest: muted
// crossed-out speaker when off, accent speaker when on.
//
// Pressing it also initializes the shared audio engine. That is not incidental —
// browsers only resume a suspended AudioContext inside a live user activation,
// and every later utterance is triggered by an arriving message, not by a click.
// This press is the one gesture auto-speech gets, so it has to spend it here.
//
// Gated on the host's `ttsSpeak` capability: a daemon that cannot synthesize
// gets no toggle rather than a toggle that does nothing.
import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Volume2, VolumeX } from "@/components/icons/material-icons";
import { useTtsSpeakFeature } from "@/components/message-playback-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { useAppSettings } from "@/hooks/use-settings";
import { useAutoSpeechActive } from "@/voice/auto-speech-queue";
import { compactUp, type Theme } from "@/styles/theme";

const ThemedVolume2 = withUnistyles(Volume2);
const ThemedVolumeX = withUnistyles(VolumeX);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentMapping = (theme: Theme) => ({ color: theme.colors.accent });

interface AutoSpeechButtonProps {
  serverId: string | undefined;
  buttonIconSize: number;
}

export function AutoSpeechButton({ serverId, buttonIconSize }: AutoSpeechButtonProps) {
  const { t } = useTranslation();
  const canSpeak = useTtsSpeakFeature(serverId ?? "");
  // The queue's own view of the mode, not the raw setting: the toggle must read
  // as on exactly when playback would happen.
  const enabled = useAutoSpeechActive();
  const { updateSettings } = useAppSettings();
  const audioEngine = useVoiceAudioEngineOptional();

  const handlePress = useCallback(() => {
    const next = !enabled;
    if (next) {
      void audioEngine?.initialize().catch(() => undefined);
    }
    void updateSettings({ autoSpeech: next }).catch(() => undefined);
  }, [audioEngine, enabled, updateSettings]);

  const renderIcon = useCallback(
    ({ hovered }: { hovered?: boolean }) => {
      if (enabled) {
        return <ThemedVolume2 size={buttonIconSize} uniProps={iconAccentMapping} />;
      }
      return (
        <ThemedVolumeX
          size={buttonIconSize}
          uniProps={hovered ? iconForegroundMapping : iconForegroundMutedMapping}
        />
      );
    },
    [buttonIconSize, enabled],
  );

  const accessibilityState = useMemo(() => ({ checked: enabled }), [enabled]);

  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.button,
      Boolean(hovered) && styles.buttonHovered,
    ],
    [],
  );

  if (!canSpeak) {
    return null;
  }

  const label = enabled
    ? t("composer.voice.disableAutoSpeech")
    : t("composer.voice.enableAutoSpeech");

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        style={buttonStyle}
        testID="composer-auto-speech-toggle"
      >
        {renderIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  // Matches the mic and send buttons exactly — this row reads as one control
  // strip, and a button that sizes itself differently breaks that.
  button: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
