// Voice-preview button — a small icon button that reads a short sample aloud in
// the selected voice, shown next to voice pickers (TTS/STT settings and the
// agent-personality editor). It calls the host `speech.tts.preview` RPC, then
// plays the returned audio through the shared voice audio engine.
//
// The voice binding is soft (matches personality-voice semantics): synthesis
// runs on the host's active TTS provider with a `{name, model}` override, so an
// unavailable voice falls back to the host default rather than failing.
//
// i18n: the tooltip/accessibility copy is English-only. This button is shared
// with the agent-personality editor, which is itself English-only pending a
// translation pass (build-first, translate-last), so we keep one source of
// truth here instead of splitting copy across locale-gated and un-gated callers.
import { Buffer } from "buffer";
import { useCallback, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AudioLines, Stop } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

/**
 * The single detection point for the TTS preview capability.
 * COMPAT(ttsPreview): added in v0.4.7, drop the gate when daemon floor >= v0.4.7.
 */
export function useTtsPreviewFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ttsPreview === true,
  );
}

// Local Sherpa returns "pcm;rate=24000"; OpenAI returns "pcm" (24 kHz default).
// The audio engine parses `rate=` from the mime type and defaults to 24000.
function formatToMimeType(format: string): string {
  if (format === "pcm") return "audio/pcm;rate=24000;bits=16";
  if (format === "mp3") return "audio/mpeg";
  return `audio/${format}`;
}

// Default sample read aloud when previewing a voice with no caller-supplied
// line (e.g. the TTS settings picker). English-only, same rationale as the copy.
export const VOICE_PREVIEW_SAMPLE_TEXT =
  "Hi there! This is a quick preview of how this voice sounds.";

type PreviewStatus = "idle" | "loading" | "playing";

interface VoicePreviewButtonProps {
  serverId: string;
  /** Text to read aloud. The button is inert when this is blank. */
  text: string;
  // Soft voice binding, passed as primitives so callers don't construct an
  // object prop on every render. Omit `voiceName` to hear the host default.
  voiceName?: string;
  voiceModel?: string;
  voiceProvider?: string;
  disabled?: boolean;
  testID?: string;
}

const ThemedAudioLines = withUnistyles(AudioLines);
const ThemedStop = withUnistyles(Stop);
const ThemedSpinner = withUnistyles(ActivityIndicator);

const idleIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const activeIconMapping = (theme: Theme) => ({
  color: theme.colors.accent,
  size: theme.iconSize.sm,
});
const spinnerMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function VoicePreviewButton({
  serverId,
  text,
  voiceName,
  voiceModel,
  voiceProvider,
  disabled = false,
  testID,
}: VoicePreviewButtonProps) {
  const client = useHostRuntimeClient(serverId);
  const audioEngine = useVoiceAudioEngineOptional();
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [hovered, setHovered] = useState(false);
  // Monotonic token so a superseded request/playback can't revive the UI.
  const requestRef = useRef(0);

  const isInert = disabled || !client || !audioEngine || text.trim().length === 0;

  const handlePress = useCallback(async () => {
    if (!client || !audioEngine) return;

    // A press while loading or playing means "stop": invalidate the in-flight
    // token and halt playback.
    if (status !== "idle") {
      requestRef.current += 1;
      audioEngine.stop();
      setStatus("idle");
      return;
    }

    const token = (requestRef.current += 1);
    setStatus("loading");

    // Unlock the playback AudioContext *inside* this click gesture, before the
    // multi-second synthesis round-trip. Browsers only resume an AudioContext in
    // response to a live user activation; if we defer initialization until after
    // the `await` below, the gesture has expired and the context stays suspended
    // — the sample decodes but never reaches the speakers ("I hear nothing").
    // Kicking off initialize() here (not awaiting) keeps the resume() call within
    // the gesture; playback still awaits readiness via play().
    void audioEngine.initialize().catch(() => undefined);

    try {
      const voice = voiceName
        ? { provider: voiceProvider, model: voiceModel, name: voiceName }
        : undefined;
      const result = await client.previewTtsVoice({ text, voice });
      if (token !== requestRef.current) return;
      if (result.error || !result.audio) {
        if (result.error) {
          console.warn("[VoicePreview] host returned no audio:", result.error);
        }
        setStatus("idle");
        return;
      }
      const bytes = Buffer.from(result.audio, "base64");
      await audioEngine.initialize();
      audioEngine.stop();
      if (token !== requestRef.current) return;
      setStatus("playing");
      try {
        await audioEngine.play({
          type: formatToMimeType(result.format ?? "pcm"),
          size: bytes.byteLength,
          async arrayBuffer() {
            return Uint8Array.from(bytes).buffer;
          },
        });
      } catch (error) {
        // A superseding press rejects the in-flight playback (normal). Anything
        // else is a real failure worth surfacing rather than swallowing silently.
        if (token === requestRef.current) {
          console.error("[VoicePreview] playback failed:", error);
        }
      }
      if (token === requestRef.current) setStatus("idle");
    } catch (error) {
      if (token === requestRef.current) {
        console.error("[VoicePreview] preview request failed:", error);
        setStatus("idle");
      }
    }
  }, [audioEngine, client, status, text, voiceName, voiceModel, voiceProvider]);

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const active = hovered && !isInert;
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.button,
      (active || pressed || status === "playing") && styles.buttonHovered,
      isInert && styles.buttonDisabled,
    ],
    [active, isInert, status],
  );

  const label = status === "idle" ? "Preview voice" : "Stop preview";

  let icon: ReactElement;
  if (status === "loading") {
    icon = <ThemedSpinner uniProps={spinnerMapping} size="small" />;
  } else if (status === "playing") {
    icon = <ThemedStop uniProps={activeIconMapping} />;
  } else {
    icon = <ThemedAudioLines uniProps={active ? activeIconMapping : idleIconMapping} />;
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={isInert}
        onPress={handlePress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={triggerStyle}
        testID={testID}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  button: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  buttonDisabled: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
