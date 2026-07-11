import type pino from "pino";
import type { Readable } from "node:stream";

export interface LogprobToken {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionCommittedEvent {
  segmentId: string;
  previousSegmentId: string | null;
}

export interface StreamingTranscriptionEvent {
  segmentId: string;
  transcript: string;
  isFinal: boolean;
  language?: string;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionSession {
  /**
   * Required PCM16LE sample rate for `appendPcm16()`.
   * Callers are responsible for resampling before appending.
   */
  requiredSampleRate: number;

  connect(): Promise<void>;
  appendPcm16(pcm16le: Buffer): void;
  commit(): void;
  clear(): void;
  close(): void;

  on(event: "committed", handler: (payload: StreamingTranscriptionCommittedEvent) => void): unknown;
  on(event: "transcript", handler: (payload: StreamingTranscriptionEvent) => void): unknown;
  on(event: "error", handler: (err: unknown) => void): unknown;
}

export interface SpeechToTextProvider {
  id: "openai" | "local" | (string & {});
  createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession;
}

export interface SpeechStreamResult {
  stream: Readable;
  format: string;
}

/**
 * Per-utterance voice override, e.g. from an Agent Personality's voice. A soft
 * binding: providers resolve it against their own catalog and silently fall back
 * to the host default when the name/model isn't theirs (a Kokoro voice on an
 * OpenAI provider, or vice versa), so it never fails synthesis.
 */
export interface SpeechVoiceOverride {
  /** Voice name (e.g. "af_heart" for Kokoro, "alloy" for OpenAI). */
  name: string;
  /** The voice's model id — used to resolve a local speaker id. */
  model?: string;
}

export interface TextToSpeechProvider {
  synthesizeSpeech(text: string, voice?: SpeechVoiceOverride): Promise<SpeechStreamResult>;
}
