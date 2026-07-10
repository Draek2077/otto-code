import { ensureSherpaOnnxModels, getSherpaOnnxModelDir } from "./sherpa/model-downloader.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  getSherpaOnnxTtsLayout,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  listSherpaOnnxModels,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "./sherpa/model-catalog.js";
import {
  listLocalTtsVoices,
  resolveLocalTtsSpeakerId,
  resolveLocalTtsVoiceName,
  type LocalTtsVoice,
} from "./sherpa/tts-voices.js";

export {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  listLocalTtsVoices,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  resolveLocalTtsSpeakerId,
  resolveLocalTtsVoiceName,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
  type LocalTtsVoice,
};

export function getLocalTtsDefaultSpeakerId(modelId: LocalTtsModelId): number {
  return getSherpaOnnxTtsLayout(modelId).defaultSpeakerId;
}

export type LocalSpeechModelSpec = ReturnType<typeof listSherpaOnnxModels>[number];

export function listLocalSpeechModels(): LocalSpeechModelSpec[] {
  return listSherpaOnnxModels();
}

export function getLocalSpeechModelDir(modelsDir: string, modelId: LocalSpeechModelId): string {
  return getSherpaOnnxModelDir(modelsDir, modelId);
}

export async function ensureLocalSpeechModels(options: {
  modelsDir: string;
  modelIds: LocalSpeechModelId[];
  logger: import("pino").Logger;
}): Promise<Record<LocalSpeechModelId, string>> {
  return ensureSherpaOnnxModels({
    modelsDir: options.modelsDir,
    modelIds: options.modelIds,
    logger: options.logger,
  });
}
