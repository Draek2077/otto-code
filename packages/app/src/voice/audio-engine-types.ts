export interface AudioEngineCallbacks {
  onCaptureData(pcm: Uint8Array): void;
  onVolumeLevel(level: number): void;
  onInterruption?(): void;
  onError?(error: Error): void;
}

export interface AudioPlaybackSource {
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
  type: string;
}

export interface AudioPlaybackOptions {
  /**
   * Linear amplitude 0..1 for THIS play call, defaulting to 1 (untouched).
   * The engine has no master volume on purpose - the caller names the channel's
   * level, because assistant speech and agent voice cues share one engine and
   * have separate sliders. See voice/audio-gain.ts.
   */
  gain?: number;
}

export interface AudioEngine {
  initialize(): Promise<void>;
  destroy(): Promise<void>;

  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  toggleMute(): boolean;
  isMuted(): boolean;

  play(audio: AudioPlaybackSource, options?: AudioPlaybackOptions): Promise<number>;
  stop(): void;
  clearQueue(): void;
  isPlaying(): boolean;
}
