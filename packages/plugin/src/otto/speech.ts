import { z } from "zod";
import { defineRpc } from "../rpc.js";

const Host = z.string().min(1).max(256);
const Model = z.string().min(1).max(512);
export const SpeechProviderSchema = z.enum(["local", "openai"]);
export const SpeechSttSelectionSchema = z
  .object({
    provider: SpeechProviderSchema,
    model: Model,
    language: z.string().min(1).max(64),
  })
  .strict();
export const SpeechTtsSelectionSchema = z
  .object({
    provider: SpeechProviderSchema,
    model: Model,
    voice: z.string().min(1).max(512),
    speed: z.number().min(0.25).max(4),
  })
  .strict();
export type SpeechTtsSelection = z.infer<typeof SpeechTtsSelectionSchema>;
export const SpeechSettingsSchema = z
  .object({
    dictation: SpeechSttSelectionSchema.extend({ enabled: z.boolean() }),
    voice: z
      .object({
        enabled: z.boolean(),
        turnDetection: SpeechProviderSchema,
        stt: SpeechSttSelectionSchema,
        tts: SpeechTtsSelectionSchema,
      })
      .strict(),
    openai: z
      .object({
        sttBaseUrl: z.string().min(1).max(8192),
        ttsBaseUrl: z.string().min(1).max(8192),
      })
      .strict(),
  })
  .strict();
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>;
const Credential = z
  .object({
    stored: z.boolean(),
    effectiveSource: z.enum(["stored", "shared", "environment", "none"]),
  })
  .strict();
const Choice = z.object({ id: Model, label: z.string(), description: z.string() }).strict();
const Readiness = z.object({ available: z.boolean(), message: z.string() }).strict();
export const SpeechSnapshotSchema = z
  .object({
    hostId: Host,
    revision: z.string().min(1).max(128),
    settings: SpeechSettingsSchema,
    overrides: z.array(z.string()),
    credentials: z.object({ stt: Credential, tts: Credential }).strict(),
    choices: z
      .object({
        sttModels: z.array(Choice),
        ttsModels: z.array(
          Choice.extend({
            voices: z.array(z.string()),
            defaultVoice: z.string(),
            installed: z.boolean(),
          }),
        ),
        openaiSttModels: z.array(z.string()),
        openaiTtsModels: z.array(z.string()),
        openaiVoices: z.array(z.string()),
      })
      .strict(),
    readiness: z
      .object({
        dictation: Readiness,
        voice: Readiness,
        tts: Readiness,
        downloading: z.boolean(),
        missingModels: z.array(z.string()),
        error: z.string().nullable(),
        pendingSettings: z.boolean(),
        applyingSettings: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type SpeechSnapshot = z.infer<typeof SpeechSnapshotSchema>;
export const SpeechCredentialIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }).strict(),
  z.object({ kind: z.literal("replace"), value: z.string().min(1).max(32768) }).strict(),
  z.object({ kind: z.literal("remove") }).strict(),
]);
export type SpeechCredentialIntent = z.infer<typeof SpeechCredentialIntentSchema>;
export const readSpeech = defineRpc({
  name: "speech.host.read",
  input: z.object({ hostId: Host }).strict(),
  output: SpeechSnapshotSchema,
});
export const saveSpeech = defineRpc({
  name: "speech.host.save",
  input: z
    .object({
      hostId: Host,
      expectedRevision: z.string().min(1).max(128),
      settings: SpeechSettingsSchema,
      credentials: z
        .object({ stt: SpeechCredentialIntentSchema, tts: SpeechCredentialIntentSchema })
        .strict(),
    })
    .strict(),
  output: SpeechSnapshotSchema,
});
export const retrySpeech = defineRpc({
  name: "speech.host.retry",
  input: z.object({ hostId: Host, expectedRevision: z.string().min(1).max(128) }).strict(),
  output: SpeechSnapshotSchema,
});
export const synthesizeSpeech = defineRpc({
  name: "speech.audio.synthesize",
  input: z
    .object({
      hostId: Host,
      requestId: z.string().min(1).max(128),
      text: z.string().min(1).max(2048),
      selection: SpeechTtsSelectionSchema.optional(),
      pauseAfterMs: z.number().int().min(0).max(2000).optional(),
    })
    .strict(),
  output: z
    .object({ base64: z.string().max(12 * 1024 * 1024), mimeType: z.literal("audio/wav") })
    .strict(),
});
export const prepareSpeech = defineRpc({
  name: "speech.audio.prepare",
  input: z.object({ hostId: Host, text: z.string().min(1).max(65536) }).strict(),
  output: z
    .array(
      z
        .object({
          text: z.string().min(1).max(2048),
          pauseAfterMs: z.number().int().min(0).max(2000),
        })
        .strict(),
    )
    .min(1)
    .max(1024),
});
export const cancelSpeech = defineRpc({
  name: "speech.audio.cancel",
  input: z.object({ hostId: Host, requestId: z.string().min(1).max(128) }).strict(),
  output: z.object({ accepted: z.boolean() }).strict(),
});
