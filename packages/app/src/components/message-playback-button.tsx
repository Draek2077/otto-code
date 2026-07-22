// Per-message playback button — a small speaker icon in the assistant turn
// footer (beside copy/fork) that reads that turn's text aloud on demand.
//
// It calls the host `speech.tts.speak` RPC, which synthesizes the FULL message
// and streams it back sentence-by-sentence as `audio_output` chunks the session
// already plays through the shared audio engine (see session-context). Because
// the host streams per sentence, playback starts after the first sentence
// instead of waiting for the whole clip to synthesize — and there is no length
// cap. It reads in the agent's picked personality voice, resolved on the client
// from the live personality (same source as voice cues). Gated on the host's
// `ttsSpeak` capability (see useTtsSpeakFeature); needs no live voice session.
//
// i18n: English-only copy, matching the sibling voice-preview button; the
// spoken content is the message itself, and only the tooltip/a11y label is
// literal here.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Stop, Volume2 } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

interface PersonalityVoice {
  provider?: string;
  model?: string;
  name: string;
}

// Resolve the speaking agent's personality voice the same way voice cues do:
// from the LIVE personality (the agent's current personalityId + the host's
// personality roster), so it tracks whatever personality is picked — not a
// possibly-stale server snapshot. Undefined ⇒ the host reads in its default
// voice.
function useAgentPersonalityVoice(
  serverId: string,
  agentId: string | undefined,
): PersonalityVoice | undefined {
  const personalityId = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents.get(agentId)?.personalityId ?? null) : null,
  );
  const { config } = useDaemonConfig(serverId);
  return useMemo(() => {
    if (!personalityId) {
      return undefined;
    }
    const personality = config?.agentPersonalities?.personalities?.find(
      (candidate) => candidate.id === personalityId,
    );
    const voice = personality?.voice;
    return voice?.name
      ? { provider: voice.provider, model: voice.model, name: voice.name }
      : undefined;
  }, [config, personalityId]);
}

/**
 * The single detection point for the streaming message-playback capability.
 * COMPAT(ttsSpeak): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
 */
export function useTtsSpeakFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ttsSpeak === true,
  );
}

interface MessagePlaybackButtonProps {
  serverId: string;
  /** Returns the assistant turn text to read aloud, resolved on press. */
  getContent: () => string;
  /** Selects the speaking agent's personality voice; omitted uses host default. */
  agentId?: string;
  testID?: string;
}

const ThemedVolume2 = withUnistyles(Volume2);
const ThemedStop = withUnistyles(Stop);
const ThemedSpinner = withUnistyles(ActivityIndicator);

// Match the neighboring copy/fork glyphs: muted at rest, foreground on hover,
// accent while it is actively speaking so the state reads at a glance.
const idleIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const hoveredIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const activeIconMapping = (theme: Theme) => ({ color: theme.colors.accent });
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type PlaybackStatus = "idle" | "loading" | "playing";

const PLAYBACK_ICON_SIZE = 16;

export function MessagePlaybackButton({
  serverId,
  getContent,
  agentId,
  testID,
}: MessagePlaybackButtonProps) {
  const client = useHostRuntimeClient(serverId);
  const audioEngine = useVoiceAudioEngineOptional();
  const voice = useAgentPersonalityVoice(serverId, agentId);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  // Monotonic token so a superseded request/playback can't revive the UI.
  const requestRef = useRef(0);
  // The host streams audio the session-wide handler plays and reflects via this
  // per-server flag; we use it only to advance loading → playing once our audio
  // actually starts. It never drives playing → loading (the flag dips between
  // sentences), so the icon can't flicker.
  const isPlayingAudio = useSessionStore(
    (state) => state.sessions[serverId]?.isPlayingAudio ?? false,
  );

  const isInert = !client || !audioEngine;

  useEffect(() => {
    if (status === "loading" && isPlayingAudio) {
      setStatus("playing");
    }
  }, [status, isPlayingAudio]);

  const stopPlayback = useCallback(() => {
    requestRef.current += 1;
    // Flush whatever this button queued locally; the host abort stops synthesis.
    audioEngine?.stop();
    audioEngine?.clearQueue();
    void client?.cancelSpeakMessage().catch(() => undefined);
    setStatus("idle");
  }, [audioEngine, client]);

  const handlePress = useCallback(async () => {
    if (!client || !audioEngine) {
      return;
    }

    // A press while loading or playing means "stop".
    if (status !== "idle") {
      stopPlayback();
      return;
    }

    const text = getContent().trim();
    if (!text) {
      return;
    }

    const token = (requestRef.current += 1);
    setStatus("loading");

    // Flush any prior message playback so a new one starts clean, and unlock the
    // playback AudioContext *inside* this click gesture — browsers only resume a
    // context on a live user activation, so deferring past the await would leave
    // it suspended and silent.
    audioEngine.stop();
    audioEngine.clearQueue();
    void audioEngine.initialize().catch(() => undefined);

    try {
      const result = await client.speakMessage({ text, ...(voice ? { voice } : {}) });
      if (token !== requestRef.current) {
        return;
      }
      if (result.error) {
        console.warn("[MessagePlayback] host playback error:", result.error);
      }
      setStatus("idle");
    } catch (error) {
      if (token === requestRef.current) {
        console.error("[MessagePlayback] speak request failed:", error);
        setStatus("idle");
      }
    }
  }, [audioEngine, client, getContent, status, stopPlayback, voice]);

  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.button,
      isInert && styles.buttonDisabled,
      pressed && styles.buttonPressed,
    ],
    [isInert],
  );

  const label = status === "idle" ? "Play message" : "Stop playback";

  const renderIcon = useCallback(
    (hovered: boolean): ReactElement => {
      let icon: ReactElement;
      if (status === "loading") {
        // ActivityIndicator's box is larger than a 16px glyph; the fixed slot +
        // scale keep it exactly the icon's footprint so the row can't jump.
        icon = <ThemedSpinner uniProps={spinnerMapping} size="small" style={styles.spinner} />;
      } else if (status === "playing") {
        icon = <ThemedStop uniProps={activeIconMapping} size={PLAYBACK_ICON_SIZE} />;
      } else {
        icon = (
          <ThemedVolume2
            uniProps={hovered ? hoveredIconMapping : idleIconMapping}
            size={PLAYBACK_ICON_SIZE}
          />
        );
      }
      return <View style={styles.iconSlot}>{icon}</View>;
    },
    [status],
  );

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={isInert}
        onPress={handlePress}
        style={triggerStyle}
        testID={testID}
      >
        {({ hovered }: { hovered?: boolean }) => renderIcon(Boolean(hovered))}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  button: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: theme.opacity[50],
  },
  // Every icon state renders inside this fixed square so switching to the
  // spinner never resizes the footer row. overflow: hidden clips the scaled
  // spinner to the exact glyph footprint.
  iconSlot: {
    width: PLAYBACK_ICON_SIZE,
    height: PLAYBACK_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // RN ActivityIndicator "small" is ~20px; scale it down to the 16px glyph.
  spinner: {
    transform: [{ scale: PLAYBACK_ICON_SIZE / 20 }],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
