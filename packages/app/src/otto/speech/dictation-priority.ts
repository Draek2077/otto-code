import { useEffect, useRef, useState } from "react";
import type { DictationAudioSource } from "@/hooks/use-dictation-audio-source.types";
import { useSpeechPlayback } from "./playback-context";
import { createCapturePriority } from "./capture-priority";
import { createWakeCaptureGuard } from "./wake/capture-ownership";

export function useSpeechDictationPriority(source: DictationAudioSource): DictationAudioSource {
  const playback = useSpeechPlayback();
  const latest = useRef(source);
  latest.current = source;
  const [capture] = useState(() => createWakeCaptureGuard(() => latest.current));
  const [priority] = useState(() =>
    createCapturePriority(
      () => capture,
      () => playback?.retainCapture() ?? (() => {}),
    ),
  );
  useEffect(() => () => priority.close(), [priority]);
  return { ...source, start: priority.start, stop: priority.stop };
}
