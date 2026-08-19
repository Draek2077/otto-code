import { z } from "zod";

/**
 * Otto speech wire schemas: the speech.* settings, TTS preview and speak RPCs, the local STT/TTS model options, and the mutable speech daemon config. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// Speech engine ids and model ids stay plain strings on the wire so adding an
// engine or model never breaks an older peer; the daemon validates values
// against its own catalog when applying a patch.
export const MutableSpeechSttConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    language: z.string().optional(),
  })
  .passthrough();

export const MutableSpeechTtsConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    // Voice name (e.g. "af_heart" for local Kokoro, "alloy" for OpenAI). The
    // daemon maps local voice names to sherpa speaker ids internally.
    voice: z.string().optional(),
    speed: z.number().optional(),
  })
  .passthrough();

export const MutableSpeechDictationConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: MutableSpeechSttConfigSchema.optional(),
  })
  .passthrough();

export const MutableSpeechVoiceModeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: MutableSpeechSttConfigSchema.optional(),
    tts: MutableSpeechTtsConfigSchema.optional(),
  })
  .passthrough();

// Credentials for the OpenAI speech engine. The key persists to config.json
// (providers.openai.apiKey) like provider env keys do, and is echoed back in
// get_daemon_config_response the same way provider connection keys are.
export const MutableSpeechOpenAiConfigSchema = z
  .object({
    apiKey: z.string().optional(),
  })
  .passthrough();

export const MutableSpeechConfigSchema = z
  .object({
    dictation: MutableSpeechDictationConfigSchema.optional(),
    voiceMode: MutableSpeechVoiceModeConfigSchema.optional(),
    openai: MutableSpeechOpenAiConfigSchema.optional(),
  })
  .passthrough();

export type MutableSpeechConfig = z.infer<typeof MutableSpeechConfigSchema>;

export const SpeechSettingsGetOptionsRequestSchema = z.object({
  type: z.literal("speech.settings.get_options.request"),
  requestId: z.string(),
});

// One-shot "read this text aloud with this voice" for the voice-preview button.
// The voice binding is soft, matching personality-voice semantics: an
// unavailable voice degrades to the host default at synthesis time, and an
// absent voice uses the host default. Synthesis runs on the host's active TTS
// provider (there is no per-request provider switch); model/provider are hints.
export const SpeechTtsPreviewRequestSchema = z.object({
  type: z.literal("speech.tts.preview.request"),
  requestId: z.string(),
  text: z.string(),
  voice: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      name: z.string(),
    })
    .passthrough()
    .optional(),
});

// Read a full assistant message aloud on demand (the per-message playback
// button). Unlike the preview RPC - which truncates to a short sample and
// returns one buffered clip - this synthesizes the ENTIRE text and streams it
// back as `audio_output` chunks (isVoiceMode: false), one group per sentence, so
// playback starts after the first sentence instead of the whole message.
// `voice` (optional) is the speaking agent's personality voice, resolved on the
// client from the live personality (same soft-binding semantics as the preview
// button); absent uses the host default. The correlated response lands once
// playback finishes, is canceled, or errors.
export const SpeechTtsSpeakRequestSchema = z.object({
  type: z.literal("speech.tts.speak.request"),
  requestId: z.string(),
  text: z.string(),
  voice: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      name: z.string(),
    })
    .passthrough()
    .optional(),
});

// Stop the session's in-flight message playback (the button's stop press).
// Aborts synthesis on the host; the pending speak response then resolves as
// canceled and the client flushes its own audio queue.
export const SpeechTtsSpeakCancelRequestSchema = z.object({
  type: z.literal("speech.tts.speak.cancel.request"),
  requestId: z.string(),
});

export const SpeechEngineOptionSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
});

export const LocalSpeechSttModelOptionSchema = z.object({
  id: z.string(),
  // Short display name (e.g. "Parakeet v2 (English)"); older daemons omit it
  // and clients fall back to the id.
  label: z.string().optional(),
  description: z.string(),
});

export const LocalSpeechTtsModelOptionSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string(),
  voices: z.array(z.string()),
  defaultVoice: z.string(),
});

export const SpeechSettingsGetOptionsResponseSchema = z.object({
  type: z.literal("speech.settings.get_options.response"),
  payload: z
    .object({
      requestId: z.string(),
      options: z.object({
        sttEngines: z.array(SpeechEngineOptionSchema),
        ttsEngines: z.array(SpeechEngineOptionSchema),
        local: z.object({
          sttModels: z.array(LocalSpeechSttModelOptionSchema),
          ttsModels: z.array(LocalSpeechTtsModelOptionSchema),
        }),
        openai: z.object({
          configured: z.boolean(),
          sttModels: z.array(z.string()),
          ttsModels: z.array(z.string()),
          ttsVoices: z.array(z.string()),
        }),
      }),
    })
    .passthrough(),
});

export type SpeechSettingsOptions = z.infer<
  typeof SpeechSettingsGetOptionsResponseSchema
>["payload"]["options"];

export const SpeechTtsPreviewResponseSchema = z.object({
  type: z.literal("speech.tts.preview.response"),
  payload: z
    .object({
      requestId: z.string(),
      // base64-encoded audio bytes; absent when synthesis failed (see error).
      audio: z.string().optional(),
      // Media type carrying the sample rate, e.g. "audio/pcm;rate=24000",
      // so the client audio engine plays it back at the correct pitch.
      format: z.string().optional(),
      // Human-readable failure reason when audio could not be produced.
      error: z.string().optional(),
    })
    .passthrough(),
});

export type SpeechTtsPreviewResult = z.infer<typeof SpeechTtsPreviewResponseSchema>["payload"];

export const SpeechTtsSpeakResponseSchema = z.object({
  type: z.literal("speech.tts.speak.response"),
  payload: z
    .object({
      requestId: z.string(),
      // True when the full message played to completion; absent/false when it was
      // canceled or produced no audio. `error` carries a human-readable failure.
      ok: z.boolean().optional(),
      canceled: z.boolean().optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});

export type SpeechTtsSpeakResult = z.infer<typeof SpeechTtsSpeakResponseSchema>["payload"];

export const SpeechTtsSpeakCancelResponseSchema = z.object({
  type: z.literal("speech.tts.speak.cancel.response"),
  payload: z.object({ requestId: z.string() }).passthrough(),
});

export type SpeechTtsSpeakCancelResult = z.infer<
  typeof SpeechTtsSpeakCancelResponseSchema
>["payload"];
