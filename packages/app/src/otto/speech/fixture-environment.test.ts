import { expect, it } from "vitest";
import { withDisabledE2ESpeechEnv } from "../../../e2e/support/helpers/speech-env";

it("keeps ordinary E2E speech disabled and prevents inherited local model selection", () => {
  const result = withDisabledE2ESpeechEnv({
    NODE_ENV: "test",
    PASEO_VOICE_MODE_ENABLED: "1",
    PASEO_VOICE_LOCAL_TTS_MODEL: "inherited",
    PASEO_HOME: "fixture",
  });
  expect(result.PASEO_VOICE_MODE_ENABLED).toBe("0");
  expect(result.PASEO_DICTATION_ENABLED).toBe("0");
  expect(result.PASEO_VOICE_LOCAL_TTS_MODEL).toBeUndefined();
  expect(result.PASEO_HOME).toBe("fixture");
});

it("explicit managed fixtures have no speech environment locks and retain unrelated isolation", () => {
  const original = {
    NODE_ENV: "test" as const,
    PASEO_E2E_MANAGED_SPEECH: "1",
    PASEO_DICTATION_ENABLED: "0",
    PASEO_VOICE_MODE_ENABLED: "0",
    PASEO_VOICE_STT_PROVIDER: "openai",
    PASEO_VOICE_LOCAL_TTS_MODEL: "inherited",
    STT_API_KEY: "fixture-key",
    TTS_SPEED: "2",
    PASEO_HOME: "fixture",
    PASEO_LISTEN: "127.0.0.1:1234",
  };
  const result = withDisabledE2ESpeechEnv(original);
  expect(result).toEqual({
    NODE_ENV: "test",
    PASEO_HOME: "fixture",
    PASEO_LISTEN: "127.0.0.1:1234",
  });
  expect(original.TTS_SPEED).toBe("2");
});
