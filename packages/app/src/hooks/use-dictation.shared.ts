import { i18n } from "@/i18n/i18next";
import type { WakeDictationStart } from "@/otto/speech/wake/dictation-session"; // OTTO(wake-word)

export type DictationStatus = "idle" | "recording" | "paused" | "uploading" | "failed";

export interface UseDictationOptions {
  ottoOnPcmSegment?: (pcm: string) => void; // OTTO(wake-word): active-command silence only; idle detector audio stays native.
  client: import("@getpaseo/client/internal/daemon-client").DaemonClient | null;
  onTranscript: (text: string, meta: { requestId: string }) => void;
  onPartialTranscript?: (text: string, meta: { requestId: string }) => void;
  onError?: (error: Error) => void;
  onPermanentFailure?: (error: Error, context: { requestId: string }) => void;
  canStart?: () => boolean;
  canConfirm?: () => boolean;
  enableDuration?: boolean;
}

export interface UseDictationResult {
  isRecording: boolean;
  isRecordingActive: () => boolean;
  isProcessing: boolean;
  partialTranscript: string;
  volume: number;
  duration: number;
  error: string | null;
  status: DictationStatus;
  startDictation: (initial?: WakeDictationStart) => Promise<void>; // OTTO(wake-word): bounded post-detection command handoff.
  cancelDictation: () => Promise<void>;
  confirmDictation: () => Promise<void>;
  retryFailedDictation: () => Promise<void>;
  discardFailedDictation: () => void;
  reset: () => void;
}

export const DURATION_TICK_MS = 1000;
export const PCM_DICTATION_FORMAT = "audio/pcm;rate=16000;bits=16";

export const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error(i18n.t("common.errors.unexpectedDictationError"));
};
