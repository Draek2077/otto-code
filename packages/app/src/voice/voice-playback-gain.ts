// The spoken-reply channel's current level, as a 0..1 gain for `engine.play()`.
//
// Read at FIRE TIME rather than subscribed to: every caller is inside a
// long-lived effect, a websocket handler, or a plain module (the voice runtime),
// where re-subscribing on a slider drag would tear down the very thing that is
// playing. Same shape and same reason as `isThinkingToneEnabled` in
// contexts/voice-context.tsx - the setting is never rendered, only consulted.
//
// This is the assistant-speech channel only: voice mode, auto-speech, the
// per-message play button, and voice mode's thinking tone. Agent voice cues
// carry their own level (`agentVoiceCuesVolume`) and the Visualizer its own
// again; nothing here multiplies into those.
import { queryClient } from "@/data/query-client";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { clampGain } from "@/voice/audio-gain";

export function readVoicePlaybackGain(): number {
  const percent =
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.voicePlaybackVolume ??
    DEFAULT_CLIENT_SETTINGS.voicePlaybackVolume;
  return clampGain(percent / 100);
}
