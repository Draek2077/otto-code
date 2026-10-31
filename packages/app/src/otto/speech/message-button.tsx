import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { speechStyles } from "./styles";
import { IDLE_SPEECH_PLAYBACK } from "./playback";
import { Volume2, Square } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useSpeechPlayback } from "./playback-context";
import { useSpeechScope } from "./scope";
import { useHostFeature } from "@/runtime/host-features";
const idle = () => IDLE_SPEECH_PLAYBACK;
const noop = () => () => {};
export function MessageSpeechButton({
  getContent,
  itemId,
}: {
  getContent: () => string;
  itemId: string;
}) {
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
  if (!available || !scope || !playback) return null;
  const label = playing ? "Stop reading" : "Read aloud";
  return (
    <View style={speechStyles.feedback}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={playing ? Square : Volume2}
            onPress={press}
            accessibilityLabel={label}
          />
        </TooltipTrigger>
        <TooltipContent>
          <Text style={speechStyles.tooltip}>{snapshot.error || label}</Text>
        </TooltipContent>
      </Tooltip>
      {snapshot.errorKey === key && snapshot.error ? (
        <Alert variant="error" size="sm" description={snapshot.error} />
      ) : null}
    </View>
  );
}
export function SettledMessageSpeech({
  message,
  itemId,
  settled,
}: {
  message: string;
  itemId: string | undefined;
  settled: boolean;
}) {
  const content = useCallback(() => message, [message]);
  return settled && itemId ? <MessageSpeechButton getContent={content} itemId={itemId} /> : null;
}
