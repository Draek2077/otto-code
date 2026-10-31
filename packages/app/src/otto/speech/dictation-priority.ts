import { useEffect, useRef, useState } from "react";
import type { DictationAudioSource } from "@/hooks/use-dictation-audio-source.types";
import { useSpeechPlayback } from "./playback-context";
import { createCapturePriority } from "./capture-priority";

export function useSpeechDictationPriority(source: DictationAudioSource): DictationAudioSource {
  const playback = useSpeechPlayback();
  const latest = useRef(source);
  latest.current = source;
  const [priority] = useState(() =>
    createCapturePriority(
      () => latest.current,
      () => playback?.retainCapture() ?? (() => {}),
    ),
  );
  useEffect(() => () => priority.close(), [priority]);
  return { ...source, start: priority.start, stop: priority.stop };
}
