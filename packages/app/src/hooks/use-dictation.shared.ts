import { i18n } from "@/i18n/i18next";

export type DictationStatus = "idle" | "recording" | "uploading" | "failed";

export interface UseDictationOptions {
  client: import("@otto-code/client/internal/daemon-client").DaemonClient | null;
  onTranscript: (text: string, meta: { requestId: string }) => void;
  onPartialTranscript?: (text: string, meta: { requestId: string }) => void;
  onError?: (error: Error) => void;
  onPermanentFailure?: (error: Error, context: { requestId: string }) => void;
  canStart?: () => boolean;
  canConfirm?: () => boolean;
  enableDuration?: boolean;
  /** Silence budget used by automatic voice-activated completion. */
  silenceTimeoutMs?: number;
  /** Apply conservative local punctuation/filler cleanup before delivery. */
  cleanUp?: boolean;
}

export interface DictationStartOptions {
  /** PCM retained during the wake-word handoff. */
  preRollPcm?: string;
  /** Finish this recording after speech is followed by sustained silence. */
  finishOnSilence?: boolean;
  /** The handoff PCM already contains command speech. */
  speechAlreadyDetected?: boolean;
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
  startDictation: (options?: DictationStartOptions) => Promise<void>;
  cancelDictation: () => Promise<void>;
  confirmDictation: () => Promise<void>;
  retryFailedDictation: () => Promise<void>;
  discardFailedDictation: () => void;
  reset: () => void;
}

export const DURATION_TICK_MS = 1000;
export const PCM_DICTATION_FORMAT = "audio/pcm;rate=16000;bits=16";

/**
 * Make a transcript read like written input without asking a model to rewrite
 * it. This intentionally avoids changing words, which matters for code and
 * other technical prompts.
 */
export function cleanDictationText(text: string): string {
  return text
    .replace(/\b(?:um|uh|erm|hmm)\b[\s,]*/gi, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^[a-z]/, (value) => value.toUpperCase())
    .replace(/[^.!?)}]$/, "$&.");
}

export const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error(i18n.t("common.errors.unexpectedDictationError"));
};
