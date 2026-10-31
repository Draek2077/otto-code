import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AudioEngine } from "@/audio";
import { createPlayAudio } from "@/audio/play-audio";
import type { VoiceRuntime } from "@/voice/voice-runtime";
import { useSessionStore } from "@/stores/session-store";
import { hostSupportsFeature } from "@/runtime/host-features";
import { callPluginRpc } from "@getpaseo/plugin/client/host";
import { synthesizeSpeech, cancelSpeech, prepareSpeech } from "@getpaseo/plugin/otto/speech";
import { createSpeechPlayback, type SpeechPlayback } from "./playback";
import { speechGain } from "./gain";
import { speechDevicePreferences } from "./device";
import { AutoSpeechSources } from "./sources";

const Context = createContext<SpeechPlayback | null>(null);
export const useSpeechPlayback = () => useContext(Context);
export function SpeechPlaybackProvider({
  engine,
  runtime,
  children,
}: {
  engine: AudioEngine;
  runtime: VoiceRuntime;
  children: ReactNode;
}) {
  const [playback] = useState(() =>
    createSpeechPlayback({
      // COMPAT(ottoSpeech): added v0.10.0; drop when host floor >= v0.10.0, after 2027-04-30.
      available: (hostId) => {
        const session = useSessionStore.getState().sessions[hostId];
        return Boolean(
          session?.client?.isConnected && hostSupportsFeature(session.serverInfo, "ottoSpeech"),
        );
      },
      occupied: () => runtime.getSnapshot().isVoiceMode,
      prepare: async (hostId, text) => {
        const client = useSessionStore.getState().sessions[hostId]?.client;
        if (!client) throw new Error("Host disconnected.");
        return callPluginRpc(
          prepareSpeech,
          (method, value) => client.invokePluginRpc("otto-speech", method, value),
          { hostId, text },
        );
      },
      synthesize: async (input) => {
        const client = useSessionStore.getState().sessions[input.hostId]?.client;
        if (!client) throw new Error("Host disconnected.");
        return callPluginRpc(
          synthesizeSpeech,
          (method, value) => client.invokePluginRpc("otto-speech", method, value),
          input,
        );
      },
      cancel: async (hostId, requestId) => {
        const client = useSessionStore.getState().sessions[hostId]?.client;
        if (!client) return;
        return callPluginRpc(
          cancelSpeech,
          (method, value) => client.invokePluginRpc("otto-speech", method, value),
          { hostId, requestId },
        );
      },
      play: async (audio, signal, cue) => {
        const preferences = speechDevicePreferences();
        const volume = cue ? preferences.agentVoiceCuesVolume : preferences.voicePlaybackVolume;
        await createPlayAudio(
          {
            play: async (source, abort) =>
              engine.play(
                await speechGain({ ...source, ottoBackgroundPlayback: !cue }, volume),
                abort,
              ),
          },
          signal,
        )(audio);
      },
    }),
  );
  useEffect(() => {
    const voice = runtime.subscribe(playback.reconcile);
    const session = useSessionStore.subscribe(playback.reconcile);
    return () => {
      voice();
      session();
      playback.close();
    };
  }, [runtime, playback]);
  return (
    <Context.Provider value={playback}>
      <AutoSpeechSources playback={playback} />
      {children}
    </Context.Provider>
  );
}
