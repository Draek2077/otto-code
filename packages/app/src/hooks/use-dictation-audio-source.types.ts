import type { WakeDictationStart } from "@/otto/speech/wake/dictation-session"; // OTTO(wake-word)
export interface DictationAudioSourceConfig {
  onPcmSegment: (pcm16Base64: string) => void;
  onError?: (error: Error) => void;
  onInterruption?: () => void;
}

export interface DictationAudioSource {
  start: (initial?: WakeDictationStart) => Promise<void>; // OTTO(wake-word)
  stop: () => Promise<void>;
  volume: number;
  isPaused: boolean;
}
