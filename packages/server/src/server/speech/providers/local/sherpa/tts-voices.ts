import type { LocalTtsModelId } from "./model-catalog.js";

export interface LocalTtsVoice {
  speakerId: number;
  /** Kokoro voice name; prefix encodes language/accent + gender (af = American female, …). */
  name: string;
}

// Speaker-id order is fixed by each model's voices.bin; verified against the
// sherpa-onnx sample pages for kokoro-en-v0_19 and kokoro-multi-lang-v1_0.
const KOKORO_EN_V0_19_VOICE_NAMES = [
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
] as const;

const KOKORO_MULTI_LANG_V1_0_VOICE_NAMES = [
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
] as const;

const VOICE_NAMES_BY_MODEL: Record<LocalTtsModelId, readonly string[]> = {
  "kokoro-en-v0_19": KOKORO_EN_V0_19_VOICE_NAMES,
  "kokoro-multi-lang-v1_0": KOKORO_MULTI_LANG_V1_0_VOICE_NAMES,
  "kokoro-int8-multi-lang-v1_0": KOKORO_MULTI_LANG_V1_0_VOICE_NAMES,
};

export function listLocalTtsVoices(modelId: LocalTtsModelId): LocalTtsVoice[] {
  return VOICE_NAMES_BY_MODEL[modelId].map((name, speakerId) => ({ speakerId, name }));
}

export function resolveLocalTtsSpeakerId(
  modelId: LocalTtsModelId,
  voiceName: string,
): number | undefined {
  const index = VOICE_NAMES_BY_MODEL[modelId].indexOf(voiceName);
  return index >= 0 ? index : undefined;
}

export function resolveLocalTtsVoiceName(
  modelId: LocalTtsModelId,
  speakerId: number,
): string | undefined {
  return VOICE_NAMES_BY_MODEL[modelId][speakerId];
}
