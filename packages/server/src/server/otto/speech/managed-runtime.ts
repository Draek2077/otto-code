import type { Logger } from "pino";
import { createNarrationStream } from "./narration.js";
import type { PaseoOpenAIConfig, PaseoSpeechConfig } from "../../bootstrap.js";
import {
  createSpeechService,
  type SpeechService,
  type SpeechReadinessSnapshot,
} from "../../speech/speech-runtime.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";

export interface SpeechRuntimeConfiguration {
  openai?: PaseoOpenAIConfig;
  speech?: PaseoSpeechConfig;
}

export type SpeechTtsOperation<T> = (provider: TextToSpeechProvider) => Promise<T>;

interface ClosableSession {
  connect(): Promise<void>;
  close(): void;
}

function leaseSession(session: ClosableSession, release: () => void) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      session.close();
    } finally {
      release();
    }
  };
  return {
    close,
    async connect() {
      try {
        await session.connect();
      } catch (error) {
        close();
        throw error;
      }
    },
  };
}

/** One owner around Paseo's existing speech service. A save changes the desired
 * configuration; an active recording or utterance finishes before replacement.
 * No second speech stack, extra polling loop, or overlapping model generation
 * is introduced. Rapid edits coalesce while the previous generation drains.
 */
export class ManagedSpeechRuntime implements SpeechService {
  private current: SpeechService;
  private pending: SpeechRuntimeConfiguration | null = null;
  private applying: Promise<void> | null = null;
  private references = 0;
  private started = false;
  private stopped = false;
  private failure: string | null = null;
  private unsubscribe: () => void = () => {};
  private readonly listeners = new Set<(snapshot: SpeechReadinessSnapshot) => void>();
  private readonly closures = new WeakMap<SpeechService, Promise<void>>();
  private shutdown: Promise<void> | null = null;

  constructor(
    configuration: SpeechRuntimeConfiguration,
    private readonly logger: Logger,
    private readonly create: (configuration: SpeechRuntimeConfiguration) => SpeechService = (
      value,
    ) => createSpeechService({ logger, openaiConfig: value.openai, speechConfig: value.speech }),
  ) {
    this.current = create(configuration);
    this.subscribeCurrent();
  }

  get ready(): Promise<void> {
    return this.current.ready;
  }

  /** The host consumes the selected stream inside this lease, including cancelled
   * native work that cannot be interrupted. Configuration cannot free its model.
   */
  async withTts<T>(operation: SpeechTtsOperation<T>): Promise<T> {
    const release = this.retain();
    try {
      const provider = this.current.resolveTts();
      if (!provider || this.failure) throw new Error("The configured speech engine is not ready.");
      return await operation(provider);
    } finally {
      release();
    }
  }

  changeState() {
    return {
      pending: this.pending !== null,
      applying: this.applying !== null,
      error: this.failure,
    };
  }

  update(configuration: SpeechRuntimeConfiguration): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Speech service is stopped."));
    this.pending = configuration;
    this.failure = null;
    this.publish();
    return this.applyWhenIdle();
  }

  private retain(): () => void {
    if (this.stopped || this.applying)
      throw new Error("Speech settings are being applied. Try again shortly.");
    this.references++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.references--;
      void this.applyWhenIdle();
    };
  }

  private closeService(service: SpeechService): Promise<void> {
    const prior = this.closures.get(service);
    if (prior) return prior;
    const closing = Promise.resolve().then(() => service.stop());
    this.closures.set(service, closing);
    return closing;
  }

  private applyWhenIdle(): Promise<void> {
    if (this.applying) return this.applying;
    if (this.stopped || !this.pending || this.references > 0) return Promise.resolve();
    this.unsubscribe();
    this.applying = Promise.resolve()
      .then(() => this.applyPending())
      .catch((error: unknown) => {
        this.failure =
          "Speech settings could not be applied. Retry after ending active voice sessions.";
        this.logger.error({ err: error }, "Otto speech configuration failed");
      })
      .finally(() => {
        this.applying = null;
        this.publish();
      });
    this.publish();
    return this.applying;
  }

  private async applyPending(): Promise<void> {
    while (!this.stopped && this.pending && this.references === 0) {
      await this.closeService(this.current);
      if (this.stopped) return;
      const next = this.pending;
      this.pending = null;
      this.current = this.create(next);
      this.subscribeCurrent();
      if (this.started) this.current.start();
    }
  }

  private subscribeCurrent(): void {
    this.unsubscribe = this.current.onReadinessChange(() => this.publish());
  }

  private publish(): void {
    const snapshot = this.getReadiness();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn({ err: error }, "Speech readiness subscriber failed");
      }
    }
  }

  getReadiness = (): SpeechReadinessSnapshot => {
    const snapshot = this.current.getReadiness();
    if (!this.applying && !this.failure && !this.stopped) return snapshot;
    const unavailable = (state: SpeechReadinessSnapshot["dictation"]) =>
      state.enabled
        ? {
            ...state,
            available: false,
            retryable: true,
            reasonCode: "stt_unavailable" as const,
            message:
              this.failure ??
              (this.stopped ? "Speech service is stopped." : "Speech settings are being applied."),
          }
        : state;
    return {
      ...snapshot,
      dictation: unavailable(snapshot.dictation),
      realtimeVoice: unavailable(snapshot.realtimeVoice),
      voiceFeature: unavailable(snapshot.voiceFeature),
    };
  };

  onReadinessChange = (listener: (snapshot: SpeechReadinessSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.getReadiness());
    return () => {
      this.listeners.delete(listener);
    };
  };

  resolveTts = (): TextToSpeechProvider | null => {
    const owner = this.current;
    const provider = this.current.resolveTts();
    if (!provider || this.stopped || this.applying || this.failure) return null;
    return {
      synthesizeSpeech: async (text) => {
        if (owner !== this.current)
          throw new Error("Speech settings changed. Request speech again.");
        const release = this.retain();
        try {
          return await createNarrationStream(provider, text, release);
        } catch (error) {
          release();
          throw error;
        }
      },
    };
  };

  private wrapStt(provider: SpeechToTextProvider | null): SpeechToTextProvider | null {
    const owner = this.current;
    if (!provider || this.stopped || this.applying || this.failure) return null;
    return {
      id: provider.id,
      createSession: (parameters) => {
        if (owner !== this.current) throw new Error("Speech settings changed. Reconnect voice.");
        const release = this.retain();
        try {
          const session = provider.createSession(parameters);
          return {
            ...leaseSession(session, release),
            requiredSampleRate: session.requiredSampleRate,
            appendPcm16: session.appendPcm16.bind(session),
            commit: session.commit.bind(session),
            clear: session.clear.bind(session),
            on: session.on.bind(session),
          };
        } catch (error) {
          release();
          throw error;
        }
      },
    };
  }

  resolveStt = () => this.wrapStt(this.current.resolveStt());
  resolveDictationStt = () => this.wrapStt(this.current.resolveDictationStt());
  resolveSttLanguage = () => this.current.resolveSttLanguage();
  resolveDictationSttLanguage = () => this.current.resolveDictationSttLanguage();

  resolveTurnDetection = (): TurnDetectionProvider | null => {
    const owner = this.current;
    const provider = this.current.resolveTurnDetection();
    if (!provider || this.stopped || this.applying || this.failure) return null;
    return {
      id: provider.id,
      createSession: (parameters) => {
        if (owner !== this.current) throw new Error("Speech settings changed. Reconnect voice.");
        const release = this.retain();
        try {
          const session = provider.createSession(parameters);
          return {
            ...leaseSession(session, release),
            requiredSampleRate: session.requiredSampleRate,
            appendPcm16: session.appendPcm16.bind(session),
            flush: session.flush.bind(session),
            reset: session.reset.bind(session),
            on: session.on.bind(session),
          };
        } catch (error) {
          release();
          throw error;
        }
      },
    };
  };

  start = (): void => {
    if (this.stopped || this.started) return;
    this.started = true;
    this.current.start();
  };

  stop = (): Promise<void> => {
    if (this.shutdown) return this.shutdown;
    this.stopped = true;
    this.pending = null;
    this.unsubscribe();
    this.shutdown = (async () => {
      await this.applying;
      await this.closeService(this.current);
      this.listeners.clear();
    })();
    return this.shutdown;
  };
}
