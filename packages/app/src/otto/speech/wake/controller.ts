export type WakeWordState =
  | "disabled"
  | "starting"
  | "listening"
  | "recording"
  | "processing"
  | "paused"
  | "error";
export interface WakeWordSettings {
  enabled: boolean;
  phrase: string;
  sensitivity: number;
  silenceTimeoutMs: number;
  autoSend: boolean;
}
export interface WakeWordDetector {
  start(settings: Pick<WakeWordSettings, "phrase" | "sensitivity">): Promise<void>;
  stop(discardHandoff?: boolean): Promise<void>;
  onDetected(listener: (preRollPcm?: string, speechAlreadyDetected?: boolean) => void): () => void;
  onError?(listener: (error: Error) => void): () => void;
}
interface DictationActions {
  start(autoSend: boolean, preRollPcm?: string, speechAlreadyDetected?: boolean): Promise<boolean>;
  cancel(): Promise<void>;
}
/** Coordinates only local listening and one existing dictation. No idle audio
 * callback or transport is accepted by this boundary. Generation checks revoke
 * pending permission/start/detection callbacks before a replacement can run.
 */
export class WakeWordListeningController {
  private settings: WakeWordSettings | null = null;
  private state: WakeWordState = "disabled";
  private generation = 0;
  private blocked = false;
  private ownDictation = false;
  private startingCommand = false;
  private busy = false;
  private closed = false;
  private serial = Promise.resolve();
  private releases: (() => void)[];
  constructor(
    private readonly detector: WakeWordDetector,
    private readonly dictation: DictationActions,
    private readonly publish: (state: WakeWordState, error?: string) => void,
  ) {
    this.releases = [
      detector.onDetected((pcm, speech) => {
        void this.detect(pcm, speech);
      }),
    ];
    const release = detector.onError?.((error) => {
      void this.handleFailure(error);
    });
    if (release) this.releases.push(release);
  }
  private setState(state: WakeWordState, error?: string) {
    this.state = state;
    this.publish(state, error);
  }
  private sequence(operation: () => Promise<void>) {
    const next = this.serial.then(operation);
    this.serial = next.catch(() => {});
    return next;
  }
  async enable(settings: WakeWordSettings) {
    this.settings = settings;
    await this.listen();
  }
  private async listen() {
    if (this.closed || !this.settings?.enabled || this.blocked || this.busy || this.ownDictation)
      return;
    const authority = ++this.generation;
    const settings = this.settings;
    this.setState("starting");
    try {
      await this.sequence(async () => {
        await this.detector.stop(true);
        if (authority !== this.generation || this.closed) return;
        await this.detector.start(settings);
        if (authority !== this.generation || this.closed) await this.detector.stop(true);
        else this.setState("listening");
      });
    } catch (error) {
      if (authority === this.generation) await this.handleFailure(error);
    }
  }
  async pause() {
    this.blocked = true;
    if (this.ownDictation) return;
    ++this.generation;
    await this.sequence(() => this.detector.stop(true));
    if (!this.closed) this.setState("paused");
  }
  async resume() {
    this.blocked = false;
    await this.listen();
  }
  async notifyDictation(recording: boolean, processing: boolean) {
    this.busy = recording || processing;
    if (this.startingCommand) return;
    if (this.ownDictation) {
      if (processing) this.setState("processing");
      else if (recording) this.setState("recording");
      else {
        this.ownDictation = false;
        await this.listen();
      }
    } else if (!this.busy && this.state === "paused") await this.listen();
  }
  private async detect(pcm?: string, speech?: boolean) {
    if (this.state !== "listening" || this.closed || this.blocked || !this.settings?.enabled)
      return;
    const authority = this.generation;
    const autoSend = this.settings.autoSend;
    this.ownDictation = true;
    this.startingCommand = true;
    this.setState("recording");
    try {
      await this.sequence(() => this.detector.stop(false));
      if (authority !== this.generation || this.closed) return;
      const started = await this.dictation.start(autoSend, pcm, speech);
      if (authority !== this.generation || this.closed) await this.dictation.cancel();
      else if (!started)
        throw new Error("Dictation could not start. Check the host recognition settings.");
    } catch (error) {
      if (authority === this.generation) await this.handleFailure(error);
    } finally {
      this.startingCommand = false;
    }
  }
  private async handleFailure(reason: unknown) {
    ++this.generation;
    await this.sequence(() => this.detector.stop(true)).catch(() => {});
    if (this.ownDictation) await this.dictation.cancel().catch(() => {});
    this.ownDictation = false;
    if (!this.closed)
      this.setState(
        "error",
        reason instanceof Error ? reason.message : "Hey Otto listening failed.",
      );
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    ++this.generation;
    for (const release of this.releases.splice(0)) release();
    await this.sequence(() => this.detector.stop(true)).catch(() => {});
    if (this.ownDictation) await this.dictation.cancel().catch(() => {});
    this.ownDictation = false;
    this.setState("disabled");
  }
}
