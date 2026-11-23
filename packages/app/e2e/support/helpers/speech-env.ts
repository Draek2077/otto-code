const LOCAL_SPEECH_ENV_KEYS = [
  "PASEO_LOCAL_MODELS_DIR",
  "PASEO_DICTATION_LOCAL_STT_MODEL",
  "PASEO_VOICE_LOCAL_STT_MODEL",
  "PASEO_VOICE_LOCAL_TTS_MODEL",
  "PASEO_VOICE_LOCAL_TTS_SPEAKER_ID",
  "PASEO_VOICE_LOCAL_TTS_SPEED",
] as const;

const DISABLED_E2E_SPEECH_ENV = {
  PASEO_DICTATION_ENABLED: "0",
  PASEO_VOICE_MODE_ENABLED: "0",
  PASEO_DICTATION_STT_PROVIDER: "openai",
  PASEO_VOICE_TURN_DETECTION_PROVIDER: "openai",
  PASEO_VOICE_STT_PROVIDER: "openai",
  PASEO_VOICE_TTS_PROVIDER: "openai",
} as const;

export function withDisabledE2ESpeechEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // OTTO(speech): only the explicit isolated settings journey removes fixture
  // overrides. Its persisted boot config disables speech until localhost setup.
  if (env.PASEO_E2E_MANAGED_SPEECH === "1") {
    const managed = { ...env };
    for (const key of [
      "PASEO_E2E_MANAGED_SPEECH",
      ...Object.keys(DISABLED_E2E_SPEECH_ENV),
      ...LOCAL_SPEECH_ENV_KEYS,
      "PASEO_DICTATION_LANGUAGE",
      "PASEO_VOICE_LANGUAGE",
      "STT_MODEL",
      "STT_BASE_URL",
      "STT_API_KEY",
      "STT_CONFIDENCE_THRESHOLD",
      "TTS_MODEL",
      "TTS_BASE_URL",
      "TTS_API_KEY",
      "TTS_VOICE",
      "TTS_SPEED",
    ])
      delete managed[key];
    return managed;
  }
  // Default app E2E does not cover speech flows; keep restarts from starting
  // background local-model downloads for unrelated tests.
  const next: NodeJS.ProcessEnv = {
    ...env,
    ...DISABLED_E2E_SPEECH_ENV,
  };

  for (const key of LOCAL_SPEECH_ENV_KEYS) {
    delete next[key];
  }

  return next;
}
