// The composer's auto-speech toggle - the only UI for the read-aloud mode.
//
// It sits next to the dictation mic and is deliberately the same 28px round icon
// button, because the two are the same idea pointing opposite ways: the mic
// turns your voice into text, this turns the agent's text into voice. A toggle
// rather than a press-and-hold action, so its state is legible at rest: muted
// crossed-out speaker when off, accent speaker when on.
//
// Pressing it also initializes the shared audio engine. That is not incidental -
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
import { useAppSettings, useAppSettingValue } from "@/hooks/use-settings";
import { buildAgentAutoSpeechKey, type AppSettings } from "@/hooks/use-settings/storage";
import { compactUp, type Theme } from "@/styles/theme";
import type { IconSizeToken } from "@/components/icons/icon-size";
import { useIconSize } from "@/styles/theme";

const ThemedVolume2 = withUnistyles(Volume2);
const ThemedVolumeX = withUnistyles(VolumeX);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentMapping = (theme: Theme) => ({ color: theme.colors.accent });

interface AutoSpeechButtonProps {
  serverId: string | undefined;
  agentId: string | undefined;
  buttonIconSize: IconSizeToken;
}

// Optical size correction - the button box still matches its neighbours exactly,
// only the glyph inside is trimmed. The speaker glyphs ink far more of their 960
// viewBox than the mic sitting next to them: 720 units wide for `Volume2`, about
// 810 for the slashed `VolumeX`, against the mic's 560. At the same nominal size
// the toggle therefore reads as a visibly bigger control than the mic - barely
// noticeable at desktop's 16px icons, obvious at compact's 32px, which is where
// it shows. One factor for both states, keyed to the wider muted glyph, so the
// toggle does not change size when you flip it.
const SPEAKER_OPTICAL_SCALE = 0.85;

const selectAgentAutoSpeechEnabled = (settings: AppSettings): Record<string, boolean> =>
  settings.agentAutoSpeechEnabled;

export function AutoSpeechButton({ serverId, agentId, buttonIconSize }: AutoSpeechButtonProps) {
  const { t } = useTranslation();
  const canSpeak = useTtsSpeakFeature(serverId ?? "");
  // The mode is per chat, so the toggle reads and writes one key of a sparse
  // record rather than a global flag.
  const enabledAgents = useAppSettingValue(selectAgentAutoSpeechEnabled);
  const { updateSettings } = useAppSettings();
  const agentKey = serverId && agentId ? buildAgentAutoSpeechKey(serverId, agentId) : null;
  const enabled = agentKey ? (enabledAgents[agentKey] ?? false) : false;
  const audioEngine = useVoiceAudioEngineOptional();

  const handlePress = useCallback(() => {
    if (!agentKey) {
      return;
    }
    const next = !enabled;
    if (next) {
      void audioEngine?.initialize().catch(() => undefined);
    }
    // Off DELETES the key instead of storing `false`. The record is persisted
    // for the life of the install and nothing prunes it, so a chat you muted
    // once must not cost a row forever - and an absent key already means off.
    const { [agentKey]: _cleared, ...rest } = enabledAgents;
    void updateSettings({
      agentAutoSpeechEnabled: next ? { ...rest, [agentKey]: true } : rest,
    }).catch(() => undefined);
  }, [agentKey, enabled, enabledAgents, audioEngine, updateSettings]);

  // One of the few places that still needs the token resolved to a number: the optical
  // correction below is a multiplier, and the result is deliberately off the ramp.
  const iconSize = useIconSize();
  const glyphSize = Math.round(iconSize[buttonIconSize] * SPEAKER_OPTICAL_SCALE);
  const renderIcon = useCallback(
    ({ hovered }: { hovered?: boolean }) => {
      if (enabled) {
        return <ThemedVolume2 size={glyphSize} uniProps={iconAccentMapping} />;
      }
      return (
        <ThemedVolumeX
          size={glyphSize}
          uniProps={hovered ? iconForegroundMapping : iconForegroundMutedMapping}
        />
      );
    },
    [enabled, glyphSize],
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
  // Matches the mic and send buttons exactly - this row reads as one control
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
