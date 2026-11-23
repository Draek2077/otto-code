export interface WakeWordCapability {
  available: boolean;
  safePhraseSupported: boolean;
  modelVersion?: string;
  reason?: string;
}
export interface WakeWordBridge {
  capabilities(): Promise<WakeWordCapability>;
  start(input: { phrase: string; sensitivity: number }): Promise<void>;
  audio(pcm: string): Promise<void>;
  stop(): Promise<void>;
}
