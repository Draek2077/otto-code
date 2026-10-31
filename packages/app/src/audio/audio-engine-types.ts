export interface AudioEngineCallbacks {
  onCaptureData(pcm: Uint8Array): void;
  onVolumeLevel(level: number): void;
  onInterruption?(): void;
  onCaptureAvailabilityChange?(available: boolean): void;
  onError?(error: Error): void;
}

export interface AudioPlaybackSource {
  ottoBackgroundPlayback?: boolean; // OTTO(speech): output ownership, never recording permission.
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
  type: string;
}

// OTTO(wake-word): a one-shot handoff cannot reopen expired capture as manual dictation.
export interface AudioCaptureOptions {
  ottoWakeWordHandoff?: boolean;
}
export interface AudioEngine {
  initialize(): Promise<void>;
  destroy(): Promise<void>;

  startCapture(options?: AudioCaptureOptions): Promise<void>; // OTTO(wake-word)
  stopCapture(): Promise<void>;
  toggleMute(): boolean;
  isMuted(): boolean;

  play(audio: AudioPlaybackSource, signal?: AbortSignal): Promise<number>;
  stop(): void;
  clearQueue(): void;
  isPlaying(): boolean;
}

export interface AudioEngineOptions {
  traceLabel?: string;
  captureMode?: "conversation" | "dictation";
}
