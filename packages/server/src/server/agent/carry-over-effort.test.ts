import { describe, expect, it } from "vitest";
import type { AgentModelDefinition } from "./agent-sdk-types.js";
import { resolveCarriedOverEffort } from "./carry-over-effort.js";

const codexSol: AgentModelDefinition = {
  provider: "codex",
  id: "gpt-5.6-sol",
  label: "GPT-5.6 Sol",
  defaultThinkingOptionId: "low",
  thinkingOptions: [
    { id: "low", label: "Low", isDefault: true },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra high" },
  ],
};

const claudeOpus: AgentModelDefinition = {
  provider: "claude",
  id: "claude-opus-5",
  label: "Opus 5",
  defaultThinkingOptionId: "ultracode",
  thinkingOptions: [
    { id: "ultracode", label: "Ultracode", isDefault: true },
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
};

const noEffort: AgentModelDefinition = { provider: "codex", id: "plain", label: "Plain" };

describe("resolveCarriedOverEffort", () => {
  it("keeps a high-effort parent at high instead of the model's low default", () => {
    expect(
      resolveCarriedOverEffort({
        parentThinkingOptionId: "high",
        models: [codexSol],
        model: "gpt-5.6-sol",
      }),
    ).toBe("high");
  });

  it("maps a level the model lacks to the nearest one it offers", () => {
    expect(
      resolveCarriedOverEffort({
        parentThinkingOptionId: "max",
        models: [codexSol],
        model: "gpt-5.6-sol",
      }),
    ).toBe("xhigh");
  });

  it("uses the model default when the parent effort has no equivalent", () => {
    expect(
      resolveCarriedOverEffort({
        parentThinkingOptionId: "ultracode",
        models: [codexSol],
        model: "gpt-5.6-sol",
      }),
    ).toBe("low");
  });

  it("never picks ultracode implicitly", () => {
    expect(
      resolveCarriedOverEffort({
        parentThinkingOptionId: "default",
        models: [claudeOpus],
        model: "claude-opus-5",
      }),
    ).toBe("low");
  });

  it("leaves the effort to the provider when the model advertises none", () => {
    expect(
      resolveCarriedOverEffort({
        parentThinkingOptionId: "high",
        models: [noEffort],
        model: "plain",
      }),
    ).toBeUndefined();
    expect(
      resolveCarriedOverEffort({ parentThinkingOptionId: "high", models: [], model: "missing" }),
    ).toBeUndefined();
  });
});
