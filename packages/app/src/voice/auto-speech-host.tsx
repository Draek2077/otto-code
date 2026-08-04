// App-global auto-speech host: the half of auto-speech that can actually make a
// sound.
//
// `auto-speech-queue.ts` is pure control flow and deliberately knows nothing
// about hosts, clients or audio. This module supplies the missing half - one
// speaker per connected host, registered into the shared queue - and mirrors
// `AgentVoiceCuesHost` exactly, for the same reason: the pieces it needs (the
// runtime client that synthesizes, the daemon config that carries the
// personality roster, the `ttsSpeak` capability flag) are all per-server hooks.
//
// Mounted in `_layout.tsx`'s ProvidersWrapper beside AgentVoiceCuesHost - inside
// VoiceProvider so the shared audio engine resolves, and above the router so a
// route change never unmounts it mid-sentence. Renders nothing.
//
// Per-agent auto-speech: each chat toggles independently from its composer's
// speaker icon. The host owns the one subscription to the sparse settings
// record and does two things with it - hands it to the queue whole (see
// `syncEnabledAgents` for why it has to be the whole record and not one key at
// a time), and mounts one `ChatAutoSpeechSource` per enabled chat.
//
// Those sources are the other half of "switching chats does not stop playback":
// they feed the queue from the store, so a chat keeps reading whether or not it
// is the one on screen. See auto-speech-source.tsx.
//
// Reading is the personality's voice, resolved at speak time from the LIVE
// personality the same way the per-bubble playback button and voice cues do, so
// a message is read in the voice of whoever wrote it.
import { useEffect, useRef } from "react";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import {
  clearMessagePlaybackActive,
  setMessagePlaybackActive,
} from "@/agent-stream/message-playback-activity";
import { useTtsSpeakFeature } from "@/components/message-playback-button";
import { useVoiceAudioEngineOptional, useVoiceRuntimeOptional } from "@/contexts/voice-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAppSettingValue } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { autoSpeechQueue, type AutoSpeechSpeaker } from "@/voice/auto-speech-queue";
import { AutoSpeechSources } from "@/voice/auto-speech-source";

const selectAgentAutoSpeechEnabled = (settings: AppSettings): Record<string, boolean> =>
  settings.agentAutoSpeechEnabled;

function resolveVoice(
  roster: readonly AgentPersonality[] | undefined,
  serverId: string,
  agentId: string | undefined,
): { provider?: string; model?: string; name: string } | undefined {
  if (!agentId) {
    return undefined;
  }
  const personalityId = useSessionStore
    .getState()
    .sessions[serverId]?.agents.get(agentId)?.personalityId;
  if (!personalityId) {
    return undefined;
  }
  const voice = roster?.find((candidate) => candidate.id === personalityId)?.voice;
  return voice?.name
    ? { provider: voice.provider, model: voice.model, name: voice.name }
    : undefined;
}

function HostAutoSpeech({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const engine = useVoiceAudioEngineOptional();
  const canSpeak = useTtsSpeakFeature(serverId);
  const { config } = useDaemonConfig(serverId);
  // Read at speak time so a personality edit - or toggling voice mode - never
  // tears the registration down mid-queue.
  const rosterRef = useRef<readonly AgentPersonality[] | undefined>(undefined);
  rosterRef.current = config?.agentPersonalities?.personalities;
  const voiceRuntime = useVoiceRuntimeOptional();
  const voiceRuntimeRef = useRef(voiceRuntime);
  voiceRuntimeRef.current = voiceRuntime;

  useEffect(() => {
    if (!client || !engine || !canSpeak) {
      return;
    }
    const speaker: AutoSpeechSpeaker = {
      async speak(item) {
        // Live voice mode owns the speaker and the mic while it is on: reading a
        // message over it would talk across the conversation and be picked back
        // up as user speech.
        if (voiceRuntimeRef.current?.getSnapshot().isVoiceMode) {
          return;
        }
        // Best-effort autoplay unlock. The real gesture is the composer toggle,
        // which initializes the engine on press; this covers a context the OS
        // suspended since.
        void engine.initialize().catch(() => undefined);
        const voice = resolveVoice(rosterRef.current, serverId, item.agentId);
        // Marks the bubble as speaking so its playback button pins itself open
        // in the Stop state - the same registry a manual playback claims.
        setMessagePlaybackActive(item.groupId);
        try {
          const result = await client.speakMessage({
            text: item.text,
            ...(voice ? { voice } : {}),
          });
          if (result.error) {
            console.warn("[AutoSpeech] host playback error:", result.error);
          }
        } finally {
          clearMessagePlaybackActive(item.groupId);
        }
      },
      stop() {
        engine.stop();
        engine.clearQueue();
        void client.cancelSpeakMessage().catch(() => undefined);
      },
    };
    return autoSpeechQueue.registerSpeaker(serverId, speaker);
  }, [canSpeak, client, engine, serverId]);

  return null;
}

/** Headless. Mounted once per app session. */
export function AutoSpeechHost() {
  // The narrow subscription matters here: this sits at the app root, so a bare
  // `useAppSettings()` would re-render it on every unrelated settings write.
  const enabledAgents = useAppSettingValue(selectAgentAutoSpeechEnabled);
  const hosts = useHosts();

  // The setting is the mode; the queue is the runtime. Reconciling here is what
  // makes "stops immediately" true no matter which surface flipped it.
  useEffect(() => {
    autoSpeechQueue.syncEnabledAgents(enabledAgents);
  }, [enabledAgents]);

  return (
    <>
      {hosts.map((host) => (
        <HostAutoSpeech key={host.serverId} serverId={host.serverId} />
      ))}
      <AutoSpeechSources enabledAgents={enabledAgents} />
    </>
  );
}
