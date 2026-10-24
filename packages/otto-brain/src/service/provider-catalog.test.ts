import { expect, test } from "vitest";
import { defaultProfile } from "../config/profiles.js";
import type { Model } from "../types.js";
import { providerModel } from "./provider-catalog.js";

function model(): Model {
  return {
    id: "owner/model.gguf",
    displayName: "My model",
    modelPath: "/private/model.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    sizeBytes: 1,
    quant: null,
    metadata: null,
    features: { mtp: false, distilled: false, imatrix: false },
  };
}
test("provider metadata uses actual per-slot context and never returns native paths or guessed reasoning", () => {
  const fixture = model();
  const profile = {
    ...defaultProfile(fixture),
    contextSize: 32768,
    parallelSlots: 4,
    vision: false,
  };
  const result = providerModel(fixture, profile, "ready");
  expect(result).toMatchObject({
    id: fixture.id,
    name: "My model",
    context_length: 8192,
    architecture: { input_modalities: ["text"] },
    reasoning: { supported_efforts: [] },
  });
  expect(result.supported_parameters).not.toContain("reasoning_effort");
  expect(JSON.stringify(result)).not.toContain(fixture.modelPath);
});
test("vision and effort choices follow the owning hosting profile and actual template contract", () => {
  const fixture = {
    ...model(),
    reasoningTemplate: { enableThinkingArgument: "enable_thinking", effortArgument: "effort" },
    reasoningEfforts: ["off", "low", "high"],
    reasoningEffortDefault: "low",
  };
  const result = providerModel(fixture, { ...defaultProfile(fixture), vision: true }, "not-loaded");
  expect(result).toMatchObject({
    architecture: { input_modalities: ["text", "image"] },
    reasoning: { supported_efforts: ["off", "low", "high"], default_effort: "low" },
  });
  expect(result.supported_parameters).toContain("reasoning_effort");
});

test("detected reasoning controls retain explicit Off when their level list omits it", () => {
  const fixture = {
    ...model(),
    reasoningTemplate: { enableThinkingArgument: "enable_thinking", effortArgument: "effort" },
    reasoningEfforts: ["on"],
  };
  expect(providerModel(fixture, defaultProfile(fixture), "ready").reasoning).toEqual({
    supported_efforts: ["off", "on"],
    default_effort: null,
  });
});
