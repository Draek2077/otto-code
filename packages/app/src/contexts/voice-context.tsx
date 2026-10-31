import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSessionStore } from "@/stores/session-store";
import { createAudioEngine } from "@/audio";
import type { AudioEngine } from "@/audio";
import { SpeechPlaybackProvider } from "@/otto/speech/playback-context"; // OTTO(speech): shared device output and background read-aloud.
import { speechGain } from "@/otto/speech/gain"; // OTTO(speech)
import { speechDevicePreferences } from "@/otto/speech/device"; // OTTO(speech)
import {
  createVoiceRuntime,
  type VoiceRuntime,
  type VoiceRuntimeSnapshot,
  type VoiceRuntimeTelemetrySnapshot,
} from "@/voice/voice-runtime";

interface VoiceContextValue extends VoiceRuntimeSnapshot {
  startVoice: (serverId: string, agentId: string) => Promise<void>;
  stopVoice: () => Promise<void>;
  isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
  toggleMute: () => void;
}

const EMPTY_SNAPSHOT: VoiceRuntimeSnapshot = {
  phase: "disabled",
  isVoiceMode: false,
  isVoiceSwitching: false,
  isMuted: false,
  activeServerId: null,
  activeAgentId: null,
};

const EMPTY_TELEMETRY: VoiceRuntimeTelemetrySnapshot = {
  volume: 0,
  isSpeaking: false,
  segmentDuration: 0,
};

const VoiceRuntimeContext = createContext<VoiceRuntime | null>(null);
const VoiceAudioEngineContext = createContext<AudioEngine | null>(null);

const noopSubscribe = () => () => {};
const getEmptySnapshot = () => EMPTY_SNAPSHOT;
const getEmptyTelemetry = () => EMPTY_TELEMETRY;

export function useVoice() {
  const value = useVoiceOptional();
  if (!value) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  return value;
}

export function useVoiceOptional(): VoiceContextValue | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribe : noopSubscribe,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
  );

  // Methods on the runtime object literal close over factory-local state; they
  // don't use `this`, so no binding is needed. Memoising on [snapshot, runtime]
  // keeps the returned object reference stable across re-renders that don't
  // change either, preventing downstream memo/useMemo misses.
  return useMemo(() => {
    if (!runtime) {
      return null;
    }
    return {
      ...snapshot,
      startVoice: runtime.startVoice,
      stopVoice: runtime.stopVoice,
      isVoiceModeForAgent: runtime.isVoiceModeForAgent,
      toggleMute: runtime.toggleMute,
    };
  }, [snapshot, runtime]);
}

export function useVoiceTelemetry() {
  const telemetry = useVoiceTelemetryOptional();
  if (!telemetry) {
    throw new Error("useVoiceTelemetry must be used within VoiceProvider");
  }
  return telemetry;
}

export function useVoiceTelemetryOptional(): VoiceRuntimeTelemetrySnapshot | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribeTelemetry.bind(runtime) : noopSubscribe,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
  );

  return runtime ? snapshot : null;
}

export function useVoiceRuntimeOptional(): VoiceRuntime | null {
  return useContext(VoiceRuntimeContext);
}

export function useVoiceAudioEngineOptional(): AudioEngine | null {
  return useContext(VoiceAudioEngineContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const engineRef = useRef<AudioEngine | null>(null);
  const runtimeRef = useRef<VoiceRuntime | null>(null);

  if (!engineRef.current) {
    let runtime: VoiceRuntime | null = null;
    const engine = createAudioEngine({
      onCaptureData: (pcm) => {
        runtime?.handleCapturePcm(pcm);
      },
      onVolumeLevel: (level) => {
        runtime?.handleCaptureVolume(level);
      },
      onInterruption: () => {
        void runtime?.stopVoice().catch((error) => {
          console.error("[VoiceEngine] Failed to stop after audio interruption:", error);
        });
      },
      onError: (error) => {
        console.error("[VoiceEngine] Capture error:", error);
      },
    });

    // OTTO(speech): live voice PCM uses the existing device volume; file previews and cues apply their own channel gain.
    const play = engine.play;
    engine.play = async (source, signal) =>
      play(
        source.type.startsWith("audio/pcm")
          ? await speechGain(source, speechDevicePreferences().voicePlaybackVolume)
          : source,
        signal,
      );
    runtime = createVoiceRuntime({
      engine,
      canPlayThinkingTone: () => speechDevicePreferences().voiceThinkingTone, // OTTO(speech)
      getServerInfo: (serverId) =>
        useSessionStore.getState().getSession(serverId)?.serverInfo ?? null,
      activateKeepAwake: async (tag) => {
        await activateKeepAwakeAsync(tag);
      },
      deactivateKeepAwake: async (tag) => {
        await deactivateKeepAwake(tag);
      },
    });

    engineRef.current = engine;
    runtimeRef.current = runtime;
  }

  const engine = engineRef.current;
  const runtime = runtimeRef.current!;

  useEffect(() => {
    return () => {
      void runtime.destroy().catch((error) => {
        console.error("[VoiceProvider] Failed to destroy voice runtime", error);
      });
    };
  }, [runtime]);

  return (
    <VoiceAudioEngineContext.Provider value={engine}>
      <VoiceRuntimeContext.Provider value={runtime}>
        <SpeechPlaybackProvider engine={engine} runtime={runtime}>
          {children}
        </SpeechPlaybackProvider>
      </VoiceRuntimeContext.Provider>
    </VoiceAudioEngineContext.Provider>
  );
}
