import { expect, it } from "vitest";
import { SessionConfiguration } from "./session-config.js";
import { parseModels } from "./catalog.js";

it("commits a validated configuration atomically and leaves endpoint output limits unchanged by default", () => {
  const config = new SessionConfiguration(
    {
      cwd: process.cwd(),
      env: {},
      mcpServers: {},
      model: "model-one",
      settings: {},
      persist: true,
    },
    parseModels({
      data: [
        { id: "model-one" },
        { id: "model-two", reasoning: { supported_efforts: ["high", "low"], mandatory: true } },
      ],
    }),
  );
  expect(config.snapshot()).toEqual({
    model: "model-one",
    mode: "default",
    thinkingOption: "default",
    output_limit: "default",
    auto_compact: "80",
  });
  config.update({
    model: "model-two",
    thinkingOption: "low",
    mode: "plan",
    settings: { output_limit: "4096" },
  });
  const saved = config.snapshot();
  expect(saved).toEqual({
    model: "model-two",
    mode: "plan",
    thinkingOption: "low",
    output_limit: "4096",
    auto_compact: "80",
  });
  expect(() => config.update({ model: "model-one", mode: "unexpected" })).toThrow();
  expect(config.snapshot()).toEqual(saved);
  expect(() => config.update({ thinkingOption: "none" })).toThrow("does not advertise");
  expect(config.snapshot()).toEqual(saved);
  expect(config.state().settings).toContainEqual(
    expect.objectContaining({ id: "output_limit", value: "4096" }),
  );
});
