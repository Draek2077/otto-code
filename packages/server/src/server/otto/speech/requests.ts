import type { Logger } from "pino";
import type { SpeechTtsSelection } from "@getpaseo/plugin/otto/speech";
import { OpenAITTS } from "../../speech/providers/openai/tts.js";
import { WorkerBackedTextToSpeechProvider } from "../../speech/providers/local/worker-client.js";
import { LocalTtsModelIdSchema } from "../../speech/providers/local/models.js";
import { isSherpaOnnxModelInstalled } from "../../speech/providers/local/sherpa/model-downloader.js";
import type { ManagedSpeechRuntime } from "./managed-runtime.js";
import { localTtsSpeaker } from "./model-catalog.js";
import { generateSpeechWav } from "./cadence.js";

/** Cancellation suppresses late results immediately, but native work keeps its
 * admission and runtime lease until it really settles. Otherwise repeated Stop
 * could queue unbounded native work or free an in-use model.
 */
export class SpeechRequests {
  private readonly jobs = new Map<string, { clientId: string; abort: AbortController }>();
  private closed = false;
  constructor(
    private readonly runtime: ManagedSpeechRuntime,
    private readonly logger: Logger,
  ) {}

  async synthesize(input: {
    clientId: string;
    requestId: string;
    text: string;
    selection: SpeechTtsSelection;
    modelsDir: string;
    pauseAfterMs?: number;
  }) {
    const key = JSON.stringify([input.clientId, input.requestId]);
    if (this.closed || this.jobs.has(key) || this.jobs.size >= 2)
      throw new Error("Speech playback is busy. Wait for the current request to finish.");
    const abort = new AbortController();
    const job = { clientId: input.clientId, abort };
    this.jobs.set(key, job);
    const work = this.runtime.withTts(async (provider) => {
      abort.signal.throwIfAborted();
      return generateSpeechWav(
        input.text,
        (text) => this.generate(provider, { ...input, text }, abort.signal),
        abort.signal,
        input.pauseAfterMs,
      );
    });
    const finished = work
      .catch((error) => {
        if (!abort.signal.aborted)
          this.logger.warn({ err: error }, "Speech playback request failed");
        throw new Error(
          abort.signal.aborted
            ? "Speech playback was stopped."
            : "Speech could not be generated. Check the host speech settings and logs.",
          { cause: error },
        );
      })
      .finally(() => {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      });
    // Race only the client wait. `finished` still owns native completion/cleanup.
    let rejectAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("Speech playback was stopped."));
      abort.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      return await Promise.race([finished, cancelled]);
    } finally {
      if (rejectAbort) abort.signal.removeEventListener("abort", rejectAbort);
    }
  }

  private async generate(
    provider: Parameters<Parameters<ManagedSpeechRuntime["withTts"]>[0]>[0],
    input: { selection: SpeechTtsSelection; text: string; modelsDir: string },
    signal: AbortSignal,
  ) {
    const selection = input.selection;
    if (provider instanceof WorkerBackedTextToSpeechProvider && selection.provider === "local") {
      const model = LocalTtsModelIdSchema.parse(selection.model);
      if (!(await isSherpaOnnxModelInstalled(input.modelsDir, model)))
        throw new Error("Save the selected model and wait for its download before previewing.");
      signal.throwIfAborted();
      return provider.synthesizeSpeech(input.text, {
        voiceTtsModel: model,
        voiceTtsSpeakerId: localTtsSpeaker(model, selection.voice),
        voiceTtsSpeed: selection.speed,
      });
    }
    if (provider instanceof OpenAITTS && selection.provider === "openai") {
      const request = new OpenAITTS(
        {
          ...provider.getConfig(),
          model: selection.model,
          voice: selection.voice,
          speed: selection.speed,
          responseFormat: "pcm",
        },
        this.logger,
      );
      return request.synthesizeSpeech(input.text, { signal });
    }
    throw new Error("Save the selected speech provider before previewing.");
  }

  cancel(clientId: string, requestId: string) {
    const job = this.jobs.get(JSON.stringify([clientId, requestId]));
    job?.abort.abort();
    return { accepted: job !== undefined };
  }
  releaseClient(clientId: string) {
    for (const job of this.jobs.values()) if (job.clientId === clientId) job.abort.abort();
  }
  close() {
    this.closed = true;
    for (const job of this.jobs.values()) job.abort.abort();
  }
}
