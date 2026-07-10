import type { SpeechSettingsOptions } from "@otto-code/protocol/messages";

import {
  getLocalTtsDefaultSpeakerId,
  listLocalSpeechModels,
  listLocalTtsVoices,
  type LocalTtsModelId,
} from "./providers/local/models.js";

export type { SpeechSettingsOptions };

export const OPENAI_SPEECH_STT_MODELS = [
  "whisper-1",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
];

export const OPENAI_SPEECH_TTS_MODELS = ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"];

export const OPENAI_SPEECH_TTS_VOICES = [
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
];

const OPENAI_UNAVAILABLE_REASON = "OpenAI API key is not configured on the daemon.";

/** Fallback for sessions constructed without a speech service (tests, minimal daemons). */
export const EMPTY_SPEECH_SETTINGS_OPTIONS: SpeechSettingsOptions = {
  sttEngines: [],
  ttsEngines: [],
  local: { sttModels: [], ttsModels: [] },
  openai: { configured: false, sttModels: [], ttsModels: [], ttsVoices: [] },
};

function engineOption(id: string, available: boolean): SpeechSettingsOptions["sttEngines"][number] {
  return {
    id,
    available,
    ...(available ? {} : { reason: OPENAI_UNAVAILABLE_REASON }),
  };
}

export function buildSpeechSettingsOptions(params: {
  openaiAvailability: { stt: boolean; tts: boolean };
}): SpeechSettingsOptions {
  const models = listLocalSpeechModels();

  const sttModels = models
    .filter((model) => model.kind !== "tts")
    .map((model) => ({ id: model.id, label: model.label, description: model.description }));

  const ttsModels = models
    .filter((model) => model.kind === "tts")
    .map((model) => {
      const modelId = model.id as LocalTtsModelId;
      const voices = listLocalTtsVoices(modelId);
      const defaultSpeakerId = getLocalTtsDefaultSpeakerId(modelId);
      return {
        id: model.id,
        label: model.label,
        description: model.description,
        voices: voices.map((voice) => voice.name),
        defaultVoice: voices[defaultSpeakerId]?.name ?? voices[0]?.name ?? "",
      };
    });

  return {
    sttEngines: [
      engineOption("local", true),
      engineOption("openai", params.openaiAvailability.stt),
    ],
    ttsEngines: [
      engineOption("local", true),
      engineOption("openai", params.openaiAvailability.tts),
    ],
    local: { sttModels, ttsModels },
    openai: {
      configured: params.openaiAvailability.stt || params.openaiAvailability.tts,
      sttModels: OPENAI_SPEECH_STT_MODELS,
      ttsModels: OPENAI_SPEECH_TTS_MODELS,
      ttsVoices: OPENAI_SPEECH_TTS_VOICES,
    },
  };
}
