import { expect, it } from "vitest";
import { restoreSpeechSelection } from "./selection.js";

const legacy = {
  features: { voiceMode: { tts: { model: "kokoro-multi-lang-v1_0", speakerId: 9 } } },
  unrelated: { keep: true },
};
it("recovers a quarantined model and its speaker without modifying either source", () => {
  const base = {
    features: { voiceMode: { enabled: true, tts: { provider: "local" as const, speed: 1.25 } } },
  };
  const priorBase = structuredClone(base);
  const priorLegacy = structuredClone(legacy);
  expect(restoreSpeechSelection(base, legacy).features?.voiceMode?.tts).toEqual({
    provider: "local",
    speed: 1.25,
    model: "kokoro-multi-lang-v1_0",
    speakerId: 9,
  });
  expect(base).toEqual(priorBase);
  expect(legacy).toEqual(priorLegacy);
});
it("also restores a valid dormant speaking speed when no current speed overrides it", () => {
  const base = { features: { voiceMode: { tts: { provider: "local" as const } } } };
  const dormant = {
    features: {
      voiceMode: { tts: { model: "kokoro-multi-lang-v1_0", speakerId: 9, speed: 0.75 } },
    },
  };
  expect(restoreSpeechSelection(base, dormant).features?.voiceMode?.tts).toEqual({
    provider: "local",
    model: "kokoro-multi-lang-v1_0",
    speakerId: 9,
    speed: 0.75,
  });
  expect(base.features.voiceMode.tts).toEqual({ provider: "local" });
});
it("never overwrites an explicit current selection", () => {
  const base = {
    features: {
      voiceMode: { tts: { provider: "local" as const, model: "kokoro-en-v0_19", speakerId: 2 } },
    },
  };
  expect(restoreSpeechSelection(base, legacy)).toBe(base);
});
it("never applies a local voice to a newly selected OpenAI engine", () => {
  const base = { features: { voiceMode: { tts: { provider: "openai" as const } } } };
  expect(restoreSpeechSelection(base, legacy)).toBe(base);
});
it("leaves unsupported dormant models preserved and inactive", () => {
  const base = {};
  expect(
    restoreSpeechSelection(base, { features: { voiceMode: { tts: { model: "future-model" } } } }),
  ).toBe(base);
});
