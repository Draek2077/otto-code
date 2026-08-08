export type WakeWordState = "disabled" | "listening" | "recording" | "processing" | "error";

export interface WakeWordSettings {
  enabled: boolean;
  phrase: string;
  sensitivity: number;
  silenceTimeoutMs: number;
  autoSend: boolean;
}

export const DEFAULT_WAKE_WORD_SETTINGS: WakeWordSettings = {
  enabled: false,
  phrase: "Hey Otto",
  sensitivity: 0.7,
  silenceTimeoutMs: 1100,
  autoSend: false,
};

const wakeWordStatusListeners = new Set<() => void>();
let wakeWordStatus: WakeWordState = "disabled";

export function getWakeWordStatus(): WakeWordState {
  return wakeWordStatus;
}

export function subscribeWakeWordStatus(listener: () => void): () => void {
  wakeWordStatusListeners.add(listener);
  return () => wakeWordStatusListeners.delete(listener);
}

export interface WakeWordDetector {
  start(settings: Pick<WakeWordSettings, "phrase" | "sensitivity">): Promise<void>;
  stop(): Promise<void>;
  onDetected(listener: (preRollPcm?: string, speechAlreadyDetected?: boolean) => void): () => void;
}

export interface WakeWordDictationActions {
  startDictation: (
    autoSend?: boolean,
    preRollPcm?: string,
    speechAlreadyDetected?: boolean,
  ) => void | Promise<void>;
  confirmDictation: () => void | Promise<void>;
  cancelDictation?: () => void | Promise<void>;
}

/**
 * Coordinates an on-device detector with the existing dictation controller.
 * The detector owns idle microphone samples and must never expose them to the
 * daemon. This class deliberately does not accept an audio callback.
 */
export class WakeWordListeningController {
  private state: WakeWordState = "disabled";
  private unsubscribe: (() => void) | null = null;
  private settings: WakeWordSettings = DEFAULT_WAKE_WORD_SETTINGS;
  private wakeDictationActive = false;

  constructor(
    private readonly detector: WakeWordDetector,
    private readonly dictation: WakeWordDictationActions,
    private readonly onStateChange?: (state: WakeWordState, error?: Error) => void,
  ) {}

  getState(): WakeWordState {
    return this.state;
  }

  async enable(settings: WakeWordSettings): Promise<void> {
    if (!settings.enabled) {
      await this.disable();
      return;
    }
    if (this.state === "listening" || this.state === "recording" || this.state === "processing") {
      await this.disable();
    }
    this.settings = settings;
    this.setState("listening");
    try {
      this.unsubscribe = this.detector.onDetected((preRollPcm, speechAlreadyDetected) => {
        void this.handleDetection(preRollPcm, speechAlreadyDetected);
      });
      await this.detector.start(settings);
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.detector.stop().catch(() => undefined);
      this.setError(error);
      throw error;
    }
  }

  async disable(): Promise<void> {
    const shouldCancelDictation = this.wakeDictationActive;
    this.wakeDictationActive = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.detector.stop().catch(() => undefined);
    if (shouldCancelDictation) await this.dictation.cancelDictation?.();
    this.setState("disabled");
  }

  async setRecordingComplete(): Promise<void> {
    if (this.state !== "recording") return;
    this.setState("processing");
  }

  async notifyDictationState(input: {
    isRecording: boolean;
    isProcessing: boolean;
  }): Promise<void> {
    if (this.state === "recording" && input.isProcessing) {
      this.setState("processing");
      return;
    }
    if (
      (this.state === "recording" || this.state === "processing") &&
      !input.isRecording &&
      !input.isProcessing &&
      this.settings.enabled
    ) {
      await this.enable(this.settings);
    }
  }

  async recover(): Promise<void> {
    if (!this.settings.enabled) {
      this.setState("disabled");
      return;
    }
    await this.enable(this.settings);
  }

  private async handleDetection(
    preRollPcm?: string,
    speechAlreadyDetected?: boolean,
  ): Promise<void> {
    if (this.state !== "listening") return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      await this.detector.stop();
      this.wakeDictationActive = true;
      this.setState("recording");
      await this.dictation.startDictation(
        this.settings.autoSend,
        preRollPcm,
        speechAlreadyDetected,
      );
    } catch (error) {
      this.setError(error);
      return;
    }
  }

  private setState(next: WakeWordState): void {
    this.state = next;
    wakeWordStatus = next;
    wakeWordStatusListeners.forEach((listener) => listener());
    this.onStateChange?.(next);
  }

  private setError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.state = "error";
    wakeWordStatus = "error";
    wakeWordStatusListeners.forEach((listener) => listener());
    this.onStateChange?.("error", normalized);
  }
}

export function normalizeWakeWordSettings(
  input: Partial<WakeWordSettings> | null | undefined,
): WakeWordSettings {
  const source = input ?? {};
  return {
    enabled: source.enabled === true,
    phrase:
      typeof source.phrase === "string" && source.phrase.trim()
        ? source.phrase.trim()
        : DEFAULT_WAKE_WORD_SETTINGS.phrase,
    sensitivity:
      typeof source.sensitivity === "number" && Number.isFinite(source.sensitivity)
        ? Math.min(1, Math.max(0, source.sensitivity))
        : DEFAULT_WAKE_WORD_SETTINGS.sensitivity,
    silenceTimeoutMs:
      typeof source.silenceTimeoutMs === "number" && Number.isFinite(source.silenceTimeoutMs)
        ? Math.min(5000, Math.max(300, Math.round(source.silenceTimeoutMs)))
        : DEFAULT_WAKE_WORD_SETTINGS.silenceTimeoutMs,
    autoSend: source.autoSend === true,
  };
}
