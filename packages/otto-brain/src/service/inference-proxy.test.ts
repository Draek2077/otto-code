import { expect, it } from "vitest";
import { defaultProfile } from "../config/profiles.js";
import type { Model } from "../types.js";
import { prepareCompletion } from "./inference-proxy.js";

const model: Model = {
  id: "fixture",
  displayName: "Fixture",
  modelPath: "fixture.gguf",
  mmprojPath: null,
  mmprojBytes: 0,
  quant: null,
  sizeBytes: 1,
  metadata: null,
  features: { mtp: false, imatrix: false, distilled: false },
};

it("preserves multimodal/tool content while appending a hosting profile to the original system turn", () => {
  const messages = [
    { role: "system", content: [{ type: "text", text: "existing" }] },
    { role: "user", content: [{ type: "image_url", image_url: { url: "data:fixture" } }] },
  ];
  const profile = { ...defaultProfile(model), chatSystemAddendum: "profile addendum" };
  const body = {
    messages,
    tools: [{ type: "function", function: { name: "fixture" } }],
    id_slot: 666,
  };
  const parsed = JSON.parse(
    prepareCompletion(body, model, profile, 0, "/v1/chat/completions").toString(),
  );
  expect(parsed.messages[0].content).toEqual([
    { type: "text", text: "existing" },
    { type: "text", text: "profile addendum" },
  ]);
  expect(parsed.messages[1]).toEqual(messages[1]);
  expect(parsed.tools).toEqual(body.tools);
  expect(parsed.id_slot).toBe(0);
  expect(body.messages[0]!.content).toHaveLength(1);
});

it("translates only model-declared reasoning controls and clears stale effort for the generic on selection", () => {
  const reasoningModel = {
    ...model,
    reasoningEfforts: ["low", "high"],
    reasoningTemplate: { enableThinkingArgument: "thinking", effortArgument: "effort" },
  };
  const on = JSON.parse(
    prepareCompletion(
      { reasoning_effort: "on", chat_template_kwargs: { effort: "high", untouched: true } },
      reasoningModel,
      null,
      null,
      "/v1/chat/completions",
    ).toString(),
  );
  expect(on).toEqual({
    model: model.id,
    chat_template_kwargs: { thinking: true, untouched: true },
  });
  const unknown = JSON.parse(
    prepareCompletion(
      { reasoning_effort: "high", id_slot: 999 },
      model,
      null,
      null,
      "/v1/chat/completions",
    ).toString(),
  );
  expect(unknown).toEqual({ model: model.id });
});

it("appends Anthropic system parts and leaves their original cache controls intact", () => {
  const system = [{ type: "text", text: "original", cache_control: { type: "ephemeral" } }];
  const profile = { ...defaultProfile(model), chatSystemAddendum: "profile" };
  const parsed = JSON.parse(
    prepareCompletion({ system }, model, profile, null, "/v1/messages").toString(),
  );
  expect(parsed.system).toEqual([...system, { type: "text", text: "profile" }]);
});
