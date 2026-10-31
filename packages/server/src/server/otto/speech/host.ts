import path from "node:path";
import type { Logger } from "pino";
import type { PaseoDaemonConfig } from "../../bootstrap.js";
import { resolveSpeechOverrideControlledPaths } from "../../config.js";
import {
  readSpeech,
  saveSpeech,
  retrySpeech,
  synthesizeSpeech,
  cancelSpeech,
  prepareSpeech,
  type SpeechSnapshot,
} from "@getpaseo/plugin/otto/speech";
import { loadPersistedConfig, savePersistedConfig } from "../../persisted-config.js";
import { resolveSpeechConfig } from "../../speech/speech-config-resolver.js";
import { listLocalSpeechModels } from "../../speech/providers/local/models.js";
import { isSherpaOnnxModelInstalled } from "../../speech/providers/local/sherpa/model-downloader.js";
import { localTtsLayout, localTtsVoices, speechModelLabel } from "./model-catalog.js";
import { LocalTtsModelIdSchema } from "../../speech/providers/local/models.js";
import {
  speechSettings,
  speechRevision,
  speechCredential,
  patchSpeechSettings,
} from "./settings.js";
import { ManagedSpeechRuntime } from "./managed-runtime.js";
import { SpeechRequests } from "./requests.js";
import { splitTextForTts } from "./tts-segmenter.js";

export class SpeechHost {
  static forDaemon(
    config: PaseoDaemonConfig,
    hostId: string,
    runtime: ManagedSpeechRuntime,
    logger: Logger,
  ) {
    return new SpeechHost({
      hostId,
      home: config.paseoHome,
      env: config.configReload?.env ?? {},
      runtime,
      logger,
    });
  }
  private readonly requests: SpeechRequests;
  constructor(
    private readonly options: {
      hostId: string;
      home: string;
      env: NodeJS.ProcessEnv;
      runtime: ManagedSpeechRuntime;
      logger: Logger;
    },
  ) {
    this.requests = new SpeechRequests(options.runtime, options.logger);
  }

  invoke(method: string, input: unknown, clientId: string): Promise<unknown> | undefined {
    switch (method) {
      case prepareSpeech.name: {
        const value = prepareSpeech.input.parse(input);
        this.assertHost(value.hostId);
        return Promise.resolve(
          prepareSpeech.output.parse(
            splitTextForTts(value.text).map(({ text, pauseAfterMs }) => ({ text, pauseAfterMs })),
          ),
        );
      }
      case readSpeech.name: {
        const value = readSpeech.input.parse(input);
        this.assertHost(value.hostId);
        return this.read();
      }
      case saveSpeech.name:
        return this.save(saveSpeech.input.parse(input));
      case retrySpeech.name: {
        const value = retrySpeech.input.parse(input);
        this.assertRevision(value.hostId, value.expectedRevision);
        this.apply();
        return this.read();
      }
      case synthesizeSpeech.name: {
        const value = synthesizeSpeech.input.parse(input);
        this.assertHost(value.hostId);
        const settings = speechSettings(
          this.options.home,
          this.options.env,
          loadPersistedConfig(this.options.home),
        );
        if (!settings.voice.enabled)
          return Promise.reject(
            new Error("Enable speech playback in the host speech settings first."),
          );
        const change = this.options.runtime.changeState();
        if (change.pending || change.applying)
          return Promise.reject(new Error("Wait for the host to finish applying speech settings."));
        if (
          value.selection &&
          (value.selection.provider !== settings.voice.tts.provider ||
            value.selection.model !== settings.voice.tts.model)
        )
          return Promise.reject(new Error("Save the speech provider and model before previewing."));
        return this.requests.synthesize({
          ...value,
          clientId,
          selection: value.selection ?? settings.voice.tts,
          modelsDir: this.modelsDirectory(),
        });
      }
      case cancelSpeech.name: {
        const value = cancelSpeech.input.parse(input);
        this.assertHost(value.hostId);
        return Promise.resolve(this.requests.cancel(clientId, value.requestId));
      }
      default:
        return undefined;
    }
  }

  private assertHost(hostId: string) {
    if (hostId !== this.options.hostId)
      throw new Error("Speech settings belong to a different host.");
  }
  private assertRevision(hostId: string, revision: string) {
    this.assertHost(hostId);
    const persisted = loadPersistedConfig(this.options.home);
    if (speechRevision(persisted, this.options.home) !== revision)
      throw new Error("Host settings changed. Reload speech settings before saving.");
    return persisted;
  }

  private save(input: typeof saveSpeech.input._output): Promise<SpeechSnapshot> {
    // Synchronous read/compare/write: no async gap can overwrite another daemon
    // writer. External editors still need the filesystem's atomic replacement.
    const persisted = this.assertRevision(input.hostId, input.expectedRevision);
    const patch = {
      persisted,
      previous: speechSettings(this.options.home, this.options.env, persisted),
      next: input.settings,
      credentials: input.credentials,
    };
    const candidate = patchSpeechSettings({ ...patch, overrides: [] });
    const next = patchSpeechSettings({ ...patch, overrides: this.overrides(candidate) });
    // Validate the exact resulting provider configuration before committing.
    resolveSpeechConfig({ paseoHome: this.options.home, env: this.options.env, persisted: next });
    savePersistedConfig(this.options.home, next);
    this.apply();
    return this.read();
  }

  private apply() {
    const configuration = resolveSpeechConfig({
      paseoHome: this.options.home,
      env: this.options.env,
      persisted: loadPersistedConfig(this.options.home),
    });
    void this.options.runtime
      .update(configuration)
      .catch((error) =>
        this.options.logger.warn({ err: error }, "Speech settings could not be applied"),
      );
  }
  private modelsDirectory() {
    const persisted = loadPersistedConfig(this.options.home);
    return (
      this.options.env.PASEO_LOCAL_MODELS_DIR ??
      persisted.providers?.local?.modelsDir ??
      path.join(this.options.home, "models", "local-speech")
    );
  }
  private overrides(persisted: Parameters<typeof speechSettings>[2]) {
    const resolved = resolveSpeechConfig({
      paseoHome: this.options.home,
      env: this.options.env,
      persisted,
    });
    return resolveSpeechOverrideControlledPaths(this.options.env, resolved.speech.providers);
  }

  async read(): Promise<SpeechSnapshot> {
    const { home, env, runtime } = this.options;
    const persisted = loadPersistedConfig(home);
    const settings = speechSettings(home, env, persisted);
    const models = listLocalSpeechModels();
    const ttsModels = await Promise.all(
      models
        .filter((model) => model.kind === "tts")
        .map(async (entry) => {
          const model = LocalTtsModelIdSchema.parse(entry.id);
          const voices = localTtsVoices(model);
          return {
            id: model,
            label: speechModelLabel(model),
            description: entry.description,
            voices,
            defaultVoice: voices[localTtsLayout(model).defaultSpeakerId]!,
            installed: await isSherpaOnnxModelInstalled(this.modelsDirectory(), model),
          };
        }),
    );
    const readiness = runtime.getReadiness();
    const change = runtime.changeState();
    const available = runtime.resolveTts() !== null && !change.applying;
    return {
      hostId: this.options.hostId,
      revision: speechRevision(persisted, home),
      settings,
      overrides: this.overrides(persisted),
      credentials: {
        stt: speechCredential(persisted, env, "stt"),
        tts: speechCredential(persisted, env, "tts"),
      },
      choices: {
        sttModels: models
          .filter((model) => model.kind === "stt-offline")
          .map((model) => ({
            id: model.id,
            label: speechModelLabel(model.id),
            description: model.description,
          })),
        ttsModels,
        openaiSttModels: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
        openaiTtsModels: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"],
        openaiVoices: [
          "alloy",
          "ash",
          "ballad",
          "coral",
          "echo",
          "fable",
          "nova",
          "onyx",
          "sage",
          "shimmer",
          "verse",
          "marin",
          "cedar",
        ],
      },
      readiness: {
        dictation: {
          available: readiness.dictation.available,
          message: readiness.dictation.message,
        },
        voice: {
          available: readiness.realtimeVoice.available,
          message: readiness.realtimeVoice.message,
        },
        tts: {
          available,
          message: available
            ? "Speech playback is ready."
            : "Speech playback is waiting for its configured engine.",
        },
        downloading: readiness.download.inProgress,
        missingModels: readiness.missingLocalModelIds,
        error:
          change.error ??
          (readiness.download.error
            ? "Speech model download failed. Check the host connection and retry."
            : null),
        pendingSettings: change.pending,
        applyingSettings: change.applying,
      },
    };
  }

  releaseClient(clientId: string) {
    this.requests.releaseClient(clientId);
  }
  close() {
    this.requests.close();
  }
}
