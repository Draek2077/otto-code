import { expect, it } from "vitest";
import { SessionConfiguration } from "./session-config.js";
import { parseModels } from "./catalog.js";
import { qualifyModel } from "./endpoints.js";

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

it("sends a profile's actual model ID and refuses to move existing history to another endpoint", () => {
  const model = qualifyModel("remote", "vendor/model:free");
  const config = new SessionConfiguration(
    { cwd: process.cwd(), env: {}, mcpServers: {}, settings: {}, persist: true, model },
    [{ id: model, label: "Remote model" }],
    undefined,
    "remote",
  );
  expect(config.requestSettings("https://remote.invalid/v1").model).toBe("vendor/model:free");
  const before = config.snapshot();
  expect(() => config.update({ model: "primary-model" })).toThrow("new chat");
  expect(config.snapshot()).toEqual(before);
});
