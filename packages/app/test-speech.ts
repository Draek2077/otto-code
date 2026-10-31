import type { SpeechSnapshot } from "@getpaseo/plugin/otto/speech";
export function speechSnapshot(): SpeechSnapshot {
  return {
    hostId: "host",
    revision: "revision-1",
    overrides: [],
    settings: {
      dictation: {
        enabled: true,
        provider: "local",
        model: "parakeet-tdt-0.6b-v2-int8",
        language: "en",
      },
      voice: {
        enabled: true,
        turnDetection: "local",
        stt: { provider: "local", model: "parakeet-tdt-0.6b-v2-int8", language: "en" },
        tts: { provider: "local", model: "kokoro-en-v0_19", voice: "af", speed: 1 },
      },
      openai: {
        sttBaseUrl: "https://api.example.test/v1",
        ttsBaseUrl: "https://api.example.test/v1",
      },
    },
    credentials: {
      stt: { stored: false, effectiveSource: "none" },
      tts: { stored: false, effectiveSource: "none" },
    },
    choices: {
      sttModels: [],
      ttsModels: [],
      openaiSttModels: [],
      openaiTtsModels: [],
      openaiVoices: [],
    },
    readiness: {
      dictation: { available: true, message: "ready" },
      voice: { available: true, message: "ready" },
      tts: { available: true, message: "ready" },
      downloading: false,
      missingModels: [],
      error: null,
      pendingSettings: false,
      applyingSettings: false,
    },
  };
}
export function speechDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
