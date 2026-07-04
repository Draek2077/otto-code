const LOCAL_SPEECH_ENV_KEYS = [
  "OTTO_LOCAL_MODELS_DIR",
  "OTTO_DICTATION_LOCAL_STT_MODEL",
  "OTTO_VOICE_LOCAL_STT_MODEL",
  "OTTO_VOICE_LOCAL_TTS_MODEL",
  "OTTO_VOICE_LOCAL_TTS_SPEAKER_ID",
  "OTTO_VOICE_LOCAL_TTS_SPEED",
] as const;

const DISABLED_E2E_SPEECH_ENV = {
  OTTO_DICTATION_ENABLED: "0",
  OTTO_VOICE_MODE_ENABLED: "0",
  OTTO_DICTATION_STT_PROVIDER: "openai",
  OTTO_VOICE_TURN_DETECTION_PROVIDER: "openai",
  OTTO_VOICE_STT_PROVIDER: "openai",
  OTTO_VOICE_TTS_PROVIDER: "openai",
} as const;

export function withDisabledE2ESpeechEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
