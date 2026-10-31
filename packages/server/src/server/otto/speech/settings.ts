import { createHash } from "node:crypto";
import type { SpeechCredentialIntent, SpeechSettings } from "@getpaseo/plugin/otto/speech";
import { PersistedConfigSchema, type PersistedConfig } from "../../persisted-config.js";
import { resolveSpeechConfig } from "../../speech/speech-config-resolver.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
} from "../../speech/providers/local/models.js";
import { localTtsLayout, localTtsSpeaker, localTtsVoices } from "./model-catalog.js";
import { readPreservedSpeechSelection, restoreSpeechSelection } from "./selection.js";

export function speechRevision(persisted: PersistedConfig, home: string): string {
  return createHash("sha256")
    .update(JSON.stringify([persisted, readPreservedSpeechSelection(home)]))
    .digest("hex");
}

export function speechSettings(
  home: string,
  env: NodeJS.ProcessEnv,
  saved: PersistedConfig,
): SpeechSettings {
  const persisted = restoreSpeechSelection(saved, readPreservedSpeechSelection(home));
  const resolved = resolveSpeechConfig({ paseoHome: home, env, persisted });
  const providers = resolved.speech.providers;
  return {
    dictation: {
      enabled: providers.dictationStt.enabled !== false,
      ...readStt(persisted, resolved, "dictation"),
    },
    voice: {
      enabled: providers.voiceTts.enabled !== false,
      turnDetection: providers.voiceTurnDetection.provider,
      stt: readStt(persisted, resolved, "voice"),
      tts:
        providers.voiceTts.provider === "local"
          ? readLocalTts(persisted, resolved)
          : readCloudTts(persisted, resolved),
    },
    openai: {
      sttBaseUrl: readUrl(persisted, env, "stt"),
      ttsBaseUrl: readUrl(persisted, env, "tts"),
    },
  };
}

type ResolvedSpeech = ReturnType<typeof resolveSpeechConfig>;
function readStt(
  persisted: PersistedConfig,
  resolved: ResolvedSpeech,
  role: "dictation" | "voice",
): SpeechSettings["voice"]["stt"] {
  const selected =
    role === "dictation" ? persisted.features?.dictation?.stt : persisted.features?.voiceMode?.stt;
  const provider =
    role === "dictation"
      ? resolved.speech.providers.dictationStt.provider
      : resolved.speech.providers.voiceStt.provider;
  const local = resolved.speech.local?.models;
  const localModel = role === "dictation" ? local?.dictationStt : local?.voiceStt;
  const model = recognitionModel(
    provider,
    localModel,
    selected?.model,
    resolved.openai?.stt?.model,
  );
  return { provider, model, language: resolved.speech.sttLanguages?.[role] ?? "en" };
}
function recognitionModel(
  provider: "local" | "openai",
  local: string | undefined,
  selected: string | undefined,
  cloud: string | undefined,
) {
  if (provider === "local") return local ?? selected ?? DEFAULT_LOCAL_STT_MODEL;
  return cloud ?? selected ?? "whisper-1";
}
function readLocalTts(
  persisted: PersistedConfig,
  resolved: ResolvedSpeech,
): SpeechSettings["voice"]["tts"] {
  const selected = persisted.features?.voiceMode?.tts;
  const local = resolved.speech.local?.models;
  const model = LocalTtsModelIdSchema.parse(
    local?.voiceTts ?? selected?.model ?? DEFAULT_LOCAL_TTS_MODEL,
  );
  const speaker =
    local?.voiceTtsSpeakerId ?? selected?.speakerId ?? localTtsLayout(model).defaultSpeakerId;
  return {
    provider: "local",
    model,
    voice: localTtsVoices(model)[speaker] ?? String(speaker),
    speed: local?.voiceTtsSpeed ?? selected?.speed ?? 1,
  };
}
function readCloudTts(
  persisted: PersistedConfig,
  resolved: ResolvedSpeech,
): SpeechSettings["voice"]["tts"] {
  const selected = persisted.features?.voiceMode?.tts;
  const cloud = resolved.openai?.tts;
  return {
    provider: "openai",
    model: cloud?.model ?? selected?.model ?? "tts-1",
    voice: cloud?.voice ?? selected?.voice ?? "alloy",
    speed: cloud?.speed ?? selected?.speed ?? 1,
  };
}
function readUrl(persisted: PersistedConfig, env: NodeJS.ProcessEnv, endpoint: "stt" | "tts") {
  const provider = persisted.providers?.openai;
  const values = [
    provider?.[endpoint]?.baseUrl,
    env[endpoint === "stt" ? "OPENAI_STT_BASE_URL" : "OPENAI_TTS_BASE_URL"],
    provider?.baseUrl,
    env.OPENAI_BASE_URL,
  ];
  return values.find((value) => value?.trim())?.trim() ?? "https://api.openai.com/v1";
}

export function speechCredential(
  persisted: PersistedConfig,
  env: NodeJS.ProcessEnv,
  endpoint: "stt" | "tts",
) {
  const openai = persisted.providers?.openai;
  const stored = Boolean(openai?.[endpoint]?.apiKey?.trim());
  if (stored) return { stored, effectiveSource: "stored" as const };
  if (env[endpoint === "stt" ? "OPENAI_STT_API_KEY" : "OPENAI_TTS_API_KEY"]?.trim())
    return { stored, effectiveSource: "environment" as const };
  if (openai?.apiKey?.trim()) return { stored, effectiveSource: "shared" as const };
  return {
    stored,
    effectiveSource: env.OPENAI_API_KEY?.trim() ? ("environment" as const) : ("none" as const),
  };
}

function credentialPatch(
  current: { apiKey?: string; baseUrl?: string } | undefined,
  intent: SpeechCredentialIntent,
) {
  const result = { ...current };
  if (intent.kind === "replace") {
    if (!intent.value.trim()) throw new Error("Enter an API key, or explicitly choose Remove.");
    result.apiKey = intent.value.trim();
  }
  if (intent.kind === "remove") delete result.apiKey;
  return result;
}

function endpointUrl(value: string) {
  const url = new URL(value);
  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTP or HTTPS API URL without credentials, query parameters or a fragment.",
    );
}

/** Persist changed known leaves only. In particular, a form must not copy an
 * environment default into disk or erase confidence thresholds, LLM settings,
 * shared provider credentials, or the old-model preservation sidecar.
 */
export function patchSpeechSettings(input: {
  persisted: PersistedConfig;
  previous: SpeechSettings;
  next: SpeechSettings;
  credentials: { stt: SpeechCredentialIntent; tts: SpeechCredentialIntent };
  overrides: readonly string[];
}): PersistedConfig {
  const { persisted, previous, next } = input;
  validateSpeechSettings(next);
  const result = structuredClone(persisted);
  const features = (result.features ??= {});
  const dictation = (features.dictation ??= {});
  const voice = (features.voiceMode ??= {});
  const dt = (dictation.stt ??= {});
  const vs = (voice.stt ??= {});
  const vt = (voice.tts ??= {});
  const td = (voice.turnDetection ??= {});
  const set = <T, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
    before: T[K],
    path: string,
  ) => {
    if (value === before) return;
    if (input.overrides.includes(path))
      throw new Error("This speech setting is controlled by the host environment.");
    target[key] = value;
  };
  set(
    dictation,
    "enabled",
    next.dictation.enabled,
    previous.dictation.enabled,
    "features.dictation.enabled",
  );
  set(voice, "enabled", next.voice.enabled, previous.voice.enabled, "features.voiceMode.enabled");
  for (const key of ["provider", "model", "language"] as const) {
    set(dt, key, next.dictation[key], previous.dictation[key], `features.dictation.stt.${key}`);
    set(vs, key, next.voice.stt[key], previous.voice.stt[key], `features.voiceMode.stt.${key}`);
  }
  set(
    td,
    "provider",
    next.voice.turnDetection,
    previous.voice.turnDetection,
    "features.voiceMode.turnDetection.provider",
  );
  for (const key of ["provider", "model", "speed"] as const)
    set(vt, key, next.voice.tts[key], previous.voice.tts[key], `features.voiceMode.tts.${key}`);
  const newTts = next.voice.tts;
  if (newTts.provider === "local") {
    const sid = localTtsSpeaker(LocalTtsModelIdSchema.parse(newTts.model), newTts.voice);
    const old = previous.voice.tts;
    const before =
      old.provider === "local"
        ? localTtsSpeaker(LocalTtsModelIdSchema.parse(old.model), old.voice)
        : undefined;
    set(vt, "speakerId", sid, before, "features.voiceMode.tts.speakerId");
  } else
    set(
      vt,
      "voice",
      newTts.voice,
      previous.voice.tts.provider === "openai" ? previous.voice.tts.voice : undefined,
      "features.voiceMode.tts.voice",
    );
  const provider = ((result.providers ??= {}).openai ??= {});
  for (const endpoint of ["stt", "tts"] as const) {
    const value = credentialPatch(provider[endpoint], input.credentials[endpoint]);
    const urlKey = endpoint === "stt" ? "sttBaseUrl" : "ttsBaseUrl";
    if (next.openai[urlKey] !== previous.openai[urlKey]) value.baseUrl = next.openai[urlKey];
    provider[endpoint] = value;
  }
  PersistedConfigSchema.parse(result);
  return result;
}

function validateSpeechSettings(next: SpeechSettings) {
  if (
    next.dictation.enabled &&
    next.voice.enabled &&
    next.dictation.provider === "openai" &&
    next.voice.stt.provider === "openai" &&
    next.dictation.model !== next.voice.stt.model
  )
    throw new Error(
      "Dictation and live voice share this OpenAI recognition endpoint. Select the same API model for both.",
    );
  endpointUrl(next.openai.sttBaseUrl);
  endpointUrl(next.openai.ttsBaseUrl);
  for (const selection of [next.dictation, next.voice.stt]) {
    if (selection.provider === "local") LocalSttModelIdSchema.parse(selection.model);
  }
  if (next.voice.tts.provider === "local")
    localTtsSpeaker(LocalTtsModelIdSchema.parse(next.voice.tts.model), next.voice.tts.voice);
}
