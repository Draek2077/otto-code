/** Otto's additions to the existing Sherpa catalog. Keep model identifiers and
 * speaker ordering stable so an existing user's voice does not change on upgrade.
 * Vendor layout/ordering: https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
 * The packaged v1.0 runtime supports English/Chinese; voice names alone are not
 * evidence of additional language support in that package.
 */
const V1_FILES = [
  "voices.bin",
  "tokens.txt",
  "lexicon-us-en.txt",
  "lexicon-zh.txt",
  "espeak-ng-data",
];
const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

function ttsFiles(model: string): string[] {
  return [model, ...V1_FILES];
}

export const OTTO_SPEECH_MODELS = {
  "kokoro-multi-lang-v1_0": {
    kind: "tts",
    archiveUrl: `${RELEASE}/kokoro-multi-lang-v1_0.tar.bz2`,
    extractedDir: "kokoro-multi-lang-v1_0",
    requiredFiles: ttsFiles("model.onnx"),
    description: "Kokoro v1.0 (53 voices; English and Chinese runtime).",
  },
  "kokoro-int8-multi-lang-v1_0": {
    kind: "tts",
    archiveUrl: `${RELEASE}/kokoro-int8-multi-lang-v1_0.tar.bz2`,
    extractedDir: "kokoro-int8-multi-lang-v1_0",
    requiredFiles: ttsFiles("model.int8.onnx"),
    description: "Kokoro v1.0 int8 (53 voices; smaller CPU model).",
  },
} as const;

export type OttoTtsModelId = keyof typeof OTTO_SPEECH_MODELS;
export type SpeechTtsModelId = OttoTtsModelId | "kokoro-en-v0_19";
const MODEL_LABELS: Record<string, string> = {
  "parakeet-tdt-0.6b-v2-int8": "Parakeet v2 (English)",
  "parakeet-tdt-0.6b-v3-int8": "Parakeet v3 (multilingual)",
  "kokoro-en-v0_19": "Kokoro 0.19 (English)",
  "kokoro-multi-lang-v1_0": "Kokoro 1.0",
  "kokoro-int8-multi-lang-v1_0": "Kokoro 1.0 int8",
};
export function speechModelLabel(id: string) {
  return MODEL_LABELS[id] ?? id;
}

const LEGACY_VOICES = [
  "af",
  "af_bella",
  "af_nicole",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
];
const V1_VOICES = [
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis",
  "ef_dora",
  "em_alex",
  "ff_siwis",
  "hf_alpha",
  "hf_beta",
  "hm_omega",
  "hm_psi",
  "if_sara",
  "im_nicola",
  "jf_alpha",
  "jf_gongitsune",
  "jf_nezumi",
  "jf_tebukuro",
  "jm_kumo",
  "pf_dora",
  "pm_alex",
  "pm_santa",
  "zf_xiaobei",
  "zf_xiaoni",
  "zf_xiaoxiao",
  "zf_xiaoyi",
  "zm_yunjian",
  "zm_yunxi",
  "zm_yunxia",
  "zm_yunyang",
];

export function localTtsVoices(model: SpeechTtsModelId): string[] {
  return [...(model === "kokoro-en-v0_19" ? LEGACY_VOICES : V1_VOICES)];
}

export function localTtsLayout(model: SpeechTtsModelId) {
  return {
    modelFile: model === "kokoro-int8-multi-lang-v1_0" ? "model.int8.onnx" : "model.onnx",
    lexiconFiles: model === "kokoro-en-v0_19" ? [] : ["lexicon-us-en.txt", "lexicon-zh.txt"],
    defaultSpeakerId: model === "kokoro-en-v0_19" ? 0 : 3,
  };
}

export function localTtsSpeaker(model: SpeechTtsModelId, voice: string): number {
  const speaker = localTtsVoices(model).indexOf(voice);
  if (speaker < 0) throw new Error("The selected voice is not available for this speech model.");
  return speaker;
}

export function localTtsRequest(model: SpeechTtsModelId, speakerId?: number, speed?: number) {
  const sid = speakerId ?? localTtsLayout(model).defaultSpeakerId;
  const rate = speed ?? 1;
  if (!Number.isInteger(sid) || sid < 0 || sid >= localTtsVoices(model).length)
    throw new Error("The selected speaker is not available for this speech model.");
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4)
    throw new Error("Speech speed must be between 0.25 and 4.");
  return { speakerId: sid, speed: rate };
}
