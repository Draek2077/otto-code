import { z } from "zod";

export type SherpaOnnxModelKind = "stt-offline" | "tts";

type DefaultModelRole = "stt" | "tts";

export interface SherpaOnnxTtsLayout {
  modelFile: string;
  /** Lexicon files passed to sherpa's kokoro config, relative to the model dir. */
  lexiconFiles: string[];
  defaultSpeakerId: number;
}

interface SherpaOnnxCatalogEntry {
  kind: SherpaOnnxModelKind;
  archiveUrl: string;
  extractedDir: string;
  requiredFiles: string[];
  /**
   * Lowercase hex sha256 of the archive at `archiveUrl`. When set, the
   * downloader verifies the fetched archive against it and refuses to extract on
   * mismatch — the guard against a compromised release asset or a MITM'd
   * download. Leave unset only until an authoritative digest is pinned from a
   * trusted source; an unset entry downloads with a loud "integrity unverified"
   * warning rather than silently trusting the bytes.
   */
  sha256?: string;
  /** Short display name for pickers; keep it under ~24 chars. */
  label: string;
  description: string;
  defaultFor?: DefaultModelRole;
  tts?: SherpaOnnxTtsLayout;
}

export const SHERPA_ONNX_MODEL_CATALOG = {
  "parakeet-tdt-0.6b-v2-int8": {
    kind: "stt-offline",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    label: "Parakeet v2 (English)",
    description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",
    defaultFor: "stt",
  },
  "parakeet-tdt-0.6b-v3-int8": {
    kind: "stt-offline",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    label: "Parakeet v3 (25 languages)",
    description:
      "NVIDIA Parakeet TDT v3 (offline NeMo transducer, 25 European languages, auto-detected).",
  },
  "kokoro-multi-lang-v1_0": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
    extractedDir: "kokoro-multi-lang-v1_0",
    requiredFiles: [
      "model.onnx",
      "voices.bin",
      "tokens.txt",
      "lexicon-us-en.txt",
      "lexicon-zh.txt",
      "espeak-ng-data",
    ],
    label: "Kokoro v1.0",
    description: "Kokoro TTS v1.0 (53 voices; EN, ES, FR, HI, IT, JA, PT, ZH).",
    defaultFor: "tts",
    tts: {
      modelFile: "model.onnx",
      lexiconFiles: ["lexicon-us-en.txt", "lexicon-zh.txt"],
      defaultSpeakerId: 3, // af_heart
    },
  },
  "kokoro-int8-multi-lang-v1_0": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2",
    extractedDir: "kokoro-int8-multi-lang-v1_0",
    requiredFiles: [
      "model.int8.onnx",
      "voices.bin",
      "tokens.txt",
      "lexicon-us-en.txt",
      "lexicon-zh.txt",
      "espeak-ng-data",
    ],
    label: "Kokoro v1.0 (int8)",
    description: "Kokoro TTS v1.0 int8 (same 53 voices; smaller download, faster on CPU).",
    tts: {
      modelFile: "model.int8.onnx",
      lexiconFiles: ["lexicon-us-en.txt", "lexicon-zh.txt"],
      defaultSpeakerId: 3, // af_heart
    },
  },
  "kokoro-en-v0_19": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
    extractedDir: "kokoro-en-v0_19",
    requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
    label: "Kokoro v0.19 (legacy)",
    description: "Kokoro TTS v0.19 (legacy; 11 English voices).",
    tts: {
      modelFile: "model.onnx",
      lexiconFiles: [],
      defaultSpeakerId: 0, // af
    },
  },
} as const satisfies Record<string, SherpaOnnxCatalogEntry>;

export type SherpaOnnxModelId = keyof typeof SHERPA_ONNX_MODEL_CATALOG;
export type LocalSpeechModelId = SherpaOnnxModelId;

type ModelIdByKind<K extends SherpaOnnxModelKind> = {
  [Id in SherpaOnnxModelId]: (typeof SHERPA_ONNX_MODEL_CATALOG)[Id]["kind"] extends K ? Id : never;
}[SherpaOnnxModelId];

export type LocalSttModelId = ModelIdByKind<"stt-offline">;
export type LocalTtsModelId = ModelIdByKind<"tts">;

const ALL_MODEL_IDS: SherpaOnnxModelId[] = Object.keys(SHERPA_ONNX_MODEL_CATALOG).filter(
  (k): k is SherpaOnnxModelId => k in SHERPA_ONNX_MODEL_CATALOG,
);

function isLocalSttModelId(id: SherpaOnnxModelId): id is LocalSttModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind !== "tts";
}

function isLocalTtsModelId(id: SherpaOnnxModelId): id is LocalTtsModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind === "tts";
}

export const LOCAL_STT_MODEL_IDS: LocalSttModelId[] = ALL_MODEL_IDS.filter(isLocalSttModelId);

export const LOCAL_TTS_MODEL_IDS: LocalTtsModelId[] = ALL_MODEL_IDS.filter(isLocalTtsModelId);

function resolveDefaultModelId(role: "stt"): LocalSttModelId;
function resolveDefaultModelId(role: "tts"): LocalTtsModelId;
function resolveDefaultModelId(role: DefaultModelRole): SherpaOnnxModelId {
  const match = ALL_MODEL_IDS.find((id) => {
    const entry: SherpaOnnxCatalogEntry = SHERPA_ONNX_MODEL_CATALOG[id];
    return entry.defaultFor === role;
  });
  if (!match) {
    throw new Error(`No default model configured for role '${role}'`);
  }
  return match;
}

export const DEFAULT_LOCAL_STT_MODEL = resolveDefaultModelId("stt");
export const DEFAULT_LOCAL_TTS_MODEL = resolveDefaultModelId("tts");

function createModelIdSchema<T extends string>(modelIds: readonly T[]): z.ZodType<T, string> {
  const validIds = new Set<string>(modelIds);
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => validIds.has(value), {
      message: "Invalid model id",
    })
    .transform((value) => value as T);
}

export const LocalSttModelIdSchema = createModelIdSchema(LOCAL_STT_MODEL_IDS);
export const LocalTtsModelIdSchema = createModelIdSchema(LOCAL_TTS_MODEL_IDS);

export type SherpaOnnxModelSpec = SherpaOnnxCatalogEntry & {
  id: SherpaOnnxModelId;
};

export function listSherpaOnnxModels(): SherpaOnnxModelSpec[] {
  return ALL_MODEL_IDS.map((id) => Object.assign({ id }, SHERPA_ONNX_MODEL_CATALOG[id]));
}

export function getSherpaOnnxModelSpec(id: SherpaOnnxModelId): SherpaOnnxModelSpec {
  const spec = SHERPA_ONNX_MODEL_CATALOG[id];
  if (!spec) {
    throw new Error(`Unknown local speech model id: ${id}`);
  }
  return {
    id,
    ...spec,
  };
}

export function getSherpaOnnxTtsLayout(id: LocalTtsModelId): SherpaOnnxTtsLayout {
  const entry: SherpaOnnxCatalogEntry = SHERPA_ONNX_MODEL_CATALOG[id];
  if (!entry.tts) {
    throw new Error(`Local speech model '${id}' has no TTS layout`);
  }
  return entry.tts;
}
