import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { speechStyles } from "./styles";
import { IDLE_SPEECH_PLAYBACK } from "./playback";
import { Play, Square } from "lucide-react-native";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useSpeechPlayback } from "./playback-context";
import { useSpeechScope } from "./scope";
import { useHostFeature } from "@/runtime/host-features";
const idle = () => IDLE_SPEECH_PLAYBACK;
const noop = () => () => {};
const PlayIcon = withUnistyles(Play),
  StopIcon = withUnistyles(Square);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export function MessageSpeechButton({
  getContent,
  itemId,
  visible,
  dimmed,
}: {
  getContent: () => string;
  itemId: string;
  visible: boolean;
  dimmed: boolean;
}) {
  const { available, playing, error, press } = useMessagePlayback(getContent, itemId);
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  const label = playing ? "Stop reading" : "Read aloud";
  const tooltip = useMemo(
    () => <Text style={speechStyles.tooltip}>{error || label}</Text>,
    [error, label],
  );
  if (!available) return null;
  const shown = visible || playing || focused;
  return (
    <>
      <View
        testID="otto-assistant-playback"
        style={[
          bubblePlaybackStyles.slot,
          shown && bubblePlaybackStyles.visible,
          shown && dimmed && !playing && !focused && bubblePlaybackStyles.dimmed,
        ]}
        pointerEvents={shown ? "auto" : "none"}
      >
        <ToolbarButton
          compact
          round
          label={label}
          onPress={press}
          onFocus={focus}
          onBlur={blur}
          tooltip={tooltip}
        >
          {playing ? (
            <StopIcon size={12} uniProps={iconColor} />
          ) : (
            <PlayIcon size={12} uniProps={iconColor} />
          )}
        </ToolbarButton>
      </View>
      {error ? <Alert variant="error" size="sm" description={error} /> : null}
    </>
  );
}

function useMessagePlayback(getContent: () => string, itemId: string) {
  const scope = useSpeechScope();
  const playback = useSpeechPlayback();
  const available = useHostFeature(scope?.serverId, "ottoSpeech");
  const snapshot = useSyncExternalStore(playback?.subscribe ?? noop, playback?.getSnapshot ?? idle);
  const key = scope ? `${scope.serverId}:${scope.agentId}:message:${itemId}` : "";
  const playing =
    snapshot.key === key ||
    Boolean(
      scope &&
      snapshot.itemId === itemId &&
      snapshot.key?.startsWith(`${scope.serverId}:${scope.agentId}:auto:`),
    );
  const press = useCallback(() => {
    if (!scope || !playback) return;
    if (playing) playback.stop();
    else playback.speak({ hostId: scope.serverId, key, text: getContent(), itemId });
  }, [scope, playback, playing, key, getContent, itemId]);
  return {
    available: Boolean(available && scope && playback),
    playing,
    press,
    error: snapshot.errorKey === key ? snapshot.error : null,
  };
}
export function SettledMessageSpeech({
  message,
  itemId,
  settled,
  visible,
  dimmed,
}: {
  message: string;
  itemId: string | undefined;
  settled: boolean;
  visible: boolean;
  dimmed: boolean;
}) {
  const content = useCallback(() => message, [message]);
  return settled && itemId ? (
    <MessageSpeechButton getContent={content} itemId={itemId} visible={visible} dimmed={dimmed} />
  ) : null;
}

// The action overlays the bubble's lower-right corner; it adds no layout row.
const bubblePlaybackStyles = StyleSheet.create((theme) => ({
  slot: {
    position: "absolute",
    right: theme.spacing[1],
    bottom: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    opacity: 0,
  },
  visible: { opacity: 1 },
  dimmed: { opacity: 0.5 },
}));
