import { expect, it } from "vitest";
import { parseModels } from "./catalog.js";

it("uses advertised context and reasoning choices without offering disabled reasoning for mandatory models", () => {
  const models = parseModels({
    data: [
      {
        id: "reasoner",
        name: "Reasoner",
        context_length: 64000,
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["tools", "reasoning", "max_completion_tokens"],
        reasoning: {
          supported_efforts: ["high", "low", "none"],
          mandatory: true,
          default_effort: "low",
        },
      },
      { id: "plain", supported_parameters: ["tools"] },
    ],
  });
  expect(models[0]).toMatchObject({
    id: "reasoner",
    label: "Reasoner",
    contextWindowMaxTokens: 64000,
    metadata: { inputModalities: ["text", "image"], outputTokenParameter: "max_completion_tokens" },
  });
  expect(models[0]!.thinkingOptions!.map((option) => option.id)).toEqual([
    "default",
    "high",
    "low",
  ]);
  expect(models[1]!.thinkingOptions).toEqual([]);
});
