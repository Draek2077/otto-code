import { useCallback, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { useSpeechPlayback } from "./playback-context";
import { IDLE_SPEECH_PLAYBACK } from "./playback";
import { speechStyles } from "./styles";
import { Volume2, VolumeX } from "lucide-react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useHostFeature } from "@/runtime/host-features";
import { speechAgentKey } from "./preferences";
const idle = () => IDLE_SPEECH_PLAYBACK;
const noSubscription = () => () => {};
export function SpeechChatToggle({
  serverId,
  agentId,
  enabled,
}: {
  serverId: string;
  agentId: string;
  enabled: boolean;
}) {
  const available = useHostFeature(serverId, "ottoSpeech");
  const { settings, updateSettings } = useAppSettings();
  const playback = useSpeechPlayback();
  const speech = useSyncExternalStore(
    playback?.subscribe ?? noSubscription,
    playback?.getSnapshot ?? idle,
  );
  const [error, setError] = useState("");
  const key = speechAgentKey(serverId, agentId);
  const selected = settings.agentAutoSpeechEnabled[key] === true;
  const toggle = useCallback(() => {
    const next = { ...settings.agentAutoSpeechEnabled };
    if (selected) delete next[key];
    else next[key] = true;
    setError("");
    void updateSettings({ agentAutoSpeechEnabled: next }).catch(() =>
      setError("The automatic reading preference could not be saved."),
    );
  }, [settings.agentAutoSpeechEnabled, selected, key, updateSettings]);
  if (!available || !enabled) return null;
  const label = selected ? "Stop automatic reading in this chat" : "Read new replies in this chat";
  return (
    <View style={speechStyles.feedback}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={selected ? "secondary" : "ghost"}
            leftIcon={selected ? Volume2 : VolumeX}
            onPress={toggle}
            accessibilityLabel={label}
          />
        </TooltipTrigger>
        <TooltipContent>
          <Text style={speechStyles.tooltip}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      {error ? <Alert variant="error" size="sm" description={error} /> : null}
      {speech.errorKey?.startsWith(`${key}:auto:`) && speech.error ? (
        <Alert variant="error" size="sm" description={speech.error} />
      ) : null}
    </View>
  );
}
