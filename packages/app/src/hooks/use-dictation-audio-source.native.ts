import { useCallback, useEffect, useRef } from "react";
import { Buffer } from "buffer";
import { useState } from "react";

import { createAudioEngine } from "@/voice/audio-engine";

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "./use-dictation-audio-source.types";

// Match web dictation's one-second PCM16 chunks. Forwarding Android's 1024-byte
// microphone frames individually exceeds the relay's 200 messages per 10 seconds.
const PCM_CHUNK_BYTES = 16_000 * 2;

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const onInterruptionRef = useRef(config.onInterruption);
  const [volume, setVolume] = useState(0);
  const engineRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const pendingPcmRef = useRef(Buffer.alloc(0));

  const flushPendingPcm = useCallback(() => {
    const pending = pendingPcmRef.current;
    pendingPcmRef.current = Buffer.alloc(0);
    if (pending.length > 0) {
      onPcmSegmentRef.current(pending.toString("base64"));
    }
  }, []);

  const getOrCreateEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    engineRef.current = createAudioEngine({
      onCaptureData: (pcm) => {
        let pending = Buffer.concat([pendingPcmRef.current, pcm]);
        while (pending.length >= PCM_CHUNK_BYTES) {
          onPcmSegmentRef.current(pending.subarray(0, PCM_CHUNK_BYTES).toString("base64"));
          pending = pending.subarray(PCM_CHUNK_BYTES);
        }
        pendingPcmRef.current = pending;
      },
      onVolumeLevel: (level) => {
        setVolume(level);
      },
      onError: (error) => {
        onErrorRef.current?.(error);
      },
      onInterruption: () => {
        flushPendingPcm();
        onInterruptionRef.current?.();
      },
    });
    return engineRef.current;
  }, [flushPendingPcm]);

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
    onInterruptionRef.current = config.onInterruption;
  }, [config.onPcmSegment, config.onError, config.onInterruption]);

  const start = useCallback(async () => {
    pendingPcmRef.current = Buffer.alloc(0);
    const engine = getOrCreateEngine();
    await engine.initialize();
    await engine.startCapture();
  }, [getOrCreateEngine]);

  const stop = useCallback(async () => {
    await engineRef.current?.stopCapture();
    flushPendingPcm();
    setVolume(0);
  }, [flushPendingPcm]);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engineRef.current = null;
      pendingPcmRef.current = Buffer.alloc(0);
      void engine?.destroy().catch(() => undefined);
    };
  }, []);

  return {
    start,
    stop,
    volume,
  };
}
