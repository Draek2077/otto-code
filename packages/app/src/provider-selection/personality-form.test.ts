import { describe, expect, test } from "vitest";

import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import { resolvePersonalityForForm } from "./personality-form";

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    id: "p1",
    name: "Sparky",
    provider: "openai-compat",
    model: "qwen3-coder",
    effortLevel: "high",
    modeId: "yolo",
    ...overrides,
  };
}

function readyEntry(overrides: Partial<ProviderSnapshotEntry> = {}): ProviderSnapshotEntry {
  return {
    provider: "openai-compat",
    status: "ready",
    enabled: true,
    models: [
      {
        provider: "openai-compat",
        id: "qwen3-coder",
        label: "Qwen3 Coder",
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
      },
    ],
    modes: [
      { id: "yolo", label: "Yolo" },
      { id: "default", label: "Default" },
    ],
    defaultModeId: "default",
    ...overrides,
  };
}

describe("resolvePersonalityForForm", () => {
  test("resolves provider/model/mode/effort for an available personality", () => {
    const result = resolvePersonalityForForm(personality(), [readyEntry()]);
    expect(result).toEqual({
      available: true,
      values: {
        provider: "openai-compat",
        model: "qwen3-coder",
        modeId: "yolo",
        thinkingOptionId: "high",
      },
    });
  });

  test("falls back to the provider default mode when the personality has none", () => {
    const result = resolvePersonalityForForm(personality({ modeId: undefined }), [readyEntry()]);
    expect(result.available && result.values.modeId).toBe("default");
  });

  test("maps a missing effort level to the nearest option", () => {
    const entry = readyEntry({
      models: [
        {
          provider: "openai-compat",
          id: "qwen3-coder",
          label: "Qwen3 Coder",
          thinkingOptions: [
            { id: "off", label: "Off" },
            { id: "low", label: "Low" },
          ],
        },
      ],
    });
    const result = resolvePersonalityForForm(personality({ effortLevel: "max" }), [entry]);
    expect(result.available && result.values.thinkingOptionId).toBe("low");
  });

  test("is unavailable when the provider is absent", () => {
    const result = resolvePersonalityForForm(personality(), []);
    expect(result.available).toBe(false);
  });

  test("is unavailable when the model is gone", () => {
    const result = resolvePersonalityForForm(personality({ model: "ghost" }), [readyEntry()]);
    expect(result.available).toBe(false);
  });
});
