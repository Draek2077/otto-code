import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/voice/audio-engine-types";
import { resamplePcm16 } from "@/voice/resample-pcm16";

interface QueuedAudio {
  audio: AudioPlaybackSource;
  resolve: (duration: number) => void;
  reject: (error: Error) => void;
}

interface AudioEngineTraceOptions {
  traceLabel?: string;
}

function parsePcmSampleRate(mimeType: string): number | null {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return null;
  }
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: AudioEngineTraceOptions,
): AudioEngine {
  const native = require("@otto-code/expo-two-way-audio");

  const refs: {
    initialized: boolean;
    captureActive: boolean;
    muted: boolean;
    queue: QueuedAudio[];
    processingQueue: boolean;
    playbackTimeout: ReturnType<typeof setTimeout> | null;
    activePlayback: {
      resolve: (duration: number) => void;
      reject: (error: Error) => void;
      settled: boolean;
    } | null;
    destroyed: boolean;
  } = {
    initialized: false,
    captureActive: false,
    muted: false,
    queue: [],
    processingQueue: false,
    playbackTimeout: null,
    activePlayback: null,
    destroyed: false,
  };

  const microphoneSubscription = native.addExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    (event: { data: Uint8Array }) => {
      if (!refs.captureActive || refs.muted) {
        return;
      }
      const pcm = event.data;
      callbacks.onCaptureData(pcm);
    },
  );
  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      if (!refs.captureActive) {
        return;
      }
      const level = refs.muted ? 0 : event.data;
      callbacks.onVolumeLevel(level);
    },
  );
  const interruptionSubscription = native.addExpoTwoWayAudioEventListener(
    "onAudioInterruption",
    (event: { data: string }) => {
      if (event.data !== "blocked") {
        return;
      }
      const wasCaptureActive = refs.captureActive;
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (wasCaptureActive) {
        callbacks.onInterruption?.();
      }
    },
  );

  async function ensureInitialized(): Promise<void> {
    if (refs.initialized) {
      return;
    }
    const success = await native.initialize();
    if (!success) {
      throw new Error("expo-two-way-audio: native initialize() returned false");
    }
    refs.initialized = true;
  }

  async function ensureMicrophonePermission(): Promise<void> {
    let permission = await native.getMicrophonePermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      permission = await native.requestMicrophonePermissionsAsync().catch(() => null);
    }
    if (!permission?.granted) {
      throw new Error(
        "Microphone permission is required to capture audio. Please enable microphone access in system settings.",
      );
    }
  }

  function clearPlaybackTimeout(): void {
    if (refs.playbackTimeout) {
      clearTimeout(refs.playbackTimeout);
      refs.playbackTimeout = null;
    }
  }

  async function playAudio(audio: AudioPlaybackSource): Promise<number> {
    await ensureInitialized();

    return await new Promise<number>((resolve, reject) => {
      refs.activePlayback = { resolve, reject, settled: false };

      audio
        .arrayBuffer()
        .then((arrayBuffer) => {
          const pcm = new Uint8Array(arrayBuffer);
          const inputRate = parsePcmSampleRate(audio.type || "") ?? 24000;

          // Native AudioEngine expects 16kHz PCM16
          const pcm16k = resamplePcm16(pcm, inputRate, 16000);
          const durationSec = pcm16k.length / 2 / 16000;

          native.resumePlayback();
          native.playPCMData(pcm16k);

          clearPlaybackTimeout();
          refs.playbackTimeout = setTimeout(() => {
            clearPlaybackTimeout();
            const active = refs.activePlayback;
            if (!active || active.settled) {
              return;
            }
            active.settled = true;
            refs.activePlayback = null;
            resolve(durationSec);
          }, durationSec * 1000);
          return undefined;
        })
        .catch((error: unknown) => {
          clearPlaybackTimeout();
          const active = refs.activePlayback;
          if (active && !active.settled) {
            active.settled = true;
            refs.activePlayback = null;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
    });
  }

  async function processQueue(): Promise<void> {
    if (refs.processingQueue || refs.queue.length === 0) {
      return;
    }

    refs.processingQueue = true;
    while (refs.queue.length > 0) {
      const item = refs.queue.shift()!;
      try {
        const duration = await playAudio(item.audio);
        item.resolve(duration);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    refs.processingQueue = false;
  }

  return {
    async initialize() {
      await ensureInitialized();
    },

    async destroy() {
      if (refs.destroyed) {
        return;
      }
      refs.destroyed = true;
      this.stop();
      this.clearQueue();
      if (refs.captureActive) {
        native.toggleRecording(false);
        refs.captureActive = false;
      }
      clearPlaybackTimeout();
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (refs.initialized) {
        native.tearDown();
        refs.initialized = false;
      }
      microphoneSubscription.remove();
      volumeSubscription.remove();
      interruptionSubscription.remove();
    },

    async startCapture() {
      if (refs.captureActive) {
        return;
      }

      try {
        await ensureMicrophonePermission();
        await ensureInitialized();
        const isRecording = native.toggleRecording(true);
        if (!isRecording) {
          throw new Error(
            "Microphone capture could not start because Android audio focus is unavailable.",
          );
        }
        refs.captureActive = true;
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      if (refs.captureActive) {
        native.toggleRecording(false);
      }
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    async play(audio: AudioPlaybackSource) {
      return await new Promise<number>((resolve, reject) => {
        refs.queue.push({ audio, resolve, reject });
        if (!refs.processingQueue) {
          void processQueue();
        }
      });
    },

    stop() {
      native.stopPlayback();
      clearPlaybackTimeout();
      const active = refs.activePlayback;
      refs.activePlayback = null;
      if (active && !active.settled) {
        active.settled = true;
        active.reject(new Error("Playback stopped"));
      }
    },

    clearQueue() {
      while (refs.queue.length > 0) {
        refs.queue.shift()!.reject(new Error("Playback stopped"));
      }
      refs.processingQueue = false;
    },

    isPlaying() {
      return refs.activePlayback !== null;
    },
  };
}
