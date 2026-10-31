import { useCallback, useEffect, useRef } from "react";
import { Buffer } from "buffer";
import { useState } from "react";

import { createAudioEngine } from "@/audio";
import type { WakeDictationStart } from "@/otto/speech/wake/dictation-session"; // OTTO(wake-word)

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "./use-dictation-audio-source.types";

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const onInterruptionRef = useRef(config.onInterruption);
  const [volume, setVolume] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const engineRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);

  const getOrCreateEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    engineRef.current = createAudioEngine(
      {
        onCaptureData: (pcm) => {
          onPcmSegmentRef.current(Buffer.from(pcm).toString("base64"));
        },
        onVolumeLevel: (level) => {
          setVolume(level);
        },
        onError: (error) => {
          onErrorRef.current?.(error);
        },
        onInterruption: () => {
          onInterruptionRef.current?.();
        },
        onCaptureAvailabilityChange: (available) => setIsPaused(!available),
      },
      { captureMode: "dictation" },
    );
    return engineRef.current;
  }, []);

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
    onInterruptionRef.current = config.onInterruption;
  }, [config.onPcmSegment, config.onError, config.onInterruption]);

  const start = useCallback(
    async (initial?: WakeDictationStart) => {
      const engine = getOrCreateEngine();
      await engine.initialize();
      // OTTO(wake-word): leave ordinary dictation's capture call unchanged.
      if (initial?.wakeWord) await engine.startCapture({ ottoWakeWordHandoff: true });
      else await engine.startCapture();
    },
    [getOrCreateEngine],
  );

  const stop = useCallback(async () => {
    await engineRef.current?.stopCapture();
    setVolume(0);
  }, []);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.destroy().catch(() => undefined);
    };
  }, []);

  return {
    start,
    stop,
    volume,
    isPaused,
  };
}
