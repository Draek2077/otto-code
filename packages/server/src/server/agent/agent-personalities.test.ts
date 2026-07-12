import { describe, expect, test } from "vitest";

import type { AgentPersonality } from "@otto-code/protocol/messages";
import { resolvePersonality } from "./agent-personalities.js";
import type { AgentSelectOption, ProviderSnapshotEntry } from "./agent-sdk-types.js";

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    id: "p-sparky",
    name: "Sparky",
    provider: "openai-compat",
    model: "qwen3-coder",
    effortLevel: "high",
    modeId: "yolo",
    personalityPrompt: "Be bold.",
    respectGlobalAppendPrompt: false,
    roles: ["chatter", "coder"],
    spinner: { glowA: "#4ec4ff", glowB: "#e14fe8" },
    voice: { provider: "local", model: "kokoro-multi-lang-v1_0", name: "af_heart" },
    ...overrides,
  };
}

function readyEntry(overrides: Partial<ProviderSnapshotEntry> = {}): ProviderSnapshotEntry {
  const thinkingOptions: AgentSelectOption[] = [
    { id: "off", label: "Off" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ];
  return {
    provider: "openai-compat",
    status: "ready",
    enabled: true,
    models: [
      { provider: "openai-compat", id: "qwen3-coder", label: "Qwen3 Coder", thinkingOptions },
    ],
    modes: [
      { id: "yolo", label: "Yolo", isUnattended: true },
      { id: "default", label: "Default" },
    ],
    defaultModeId: "default",
    ...overrides,
  };
}

describe("resolvePersonality", () => {
  test("resolves a fully-available personality into a concrete snapshot", () => {
    const result = resolvePersonality(personality(), [readyEntry()]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot).toEqual({
      personalityId: "p-sparky",
      name: "Sparky",
      provider: "openai-compat",
      model: "qwen3-coder",
      modeId: "yolo",
      thinkingOptionId: "high",
      effortLevel: "high",
      effortMatch: "exact-id",
      effortDegraded: false,
      systemPrompt: "Be bold.",
      respectGlobalAppendPrompt: false,
      spinner: { glowA: "#4ec4ff", glowB: "#e14fe8" },
      voice: { provider: "local", model: "kokoro-multi-lang-v1_0", name: "af_heart" },
      roles: ["chatter", "coder"],
    });
  });

  test("falls back to the provider default mode when the personality has none", () => {
    const result = resolvePersonality(personality({ modeId: undefined }), [readyEntry()]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot.modeId).toBe("default");
  });

  test("defaults respectGlobalAppendPrompt to true when unset", () => {
    const result = resolvePersonality(personality({ respectGlobalAppendPrompt: undefined }), [
      readyEntry(),
    ]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot.respectGlobalAppendPrompt).toBe(true);
  });

  test("maps a requested level the model lacks to the nearest option and flags degradation", () => {
    // Model only offers off/low; a personality asking for "max" gets "low" (nearest).
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
    const result = resolvePersonality(personality({ effortLevel: "max" }), [entry]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot.thinkingOptionId).toBe("low");
    expect(result.snapshot.effortMatch).toBe("nearest");
    expect(result.snapshot.effortDegraded).toBe(true);
  });

  test("leaves effort unset (degraded) when the model advertises only custom options", () => {
    const entry = readyEntry({
      models: [
        {
          provider: "openai-compat",
          id: "qwen3-coder",
          label: "Qwen3 Coder",
          thinkingOptions: [{ id: "ultrathink", label: "Ultrathink" }],
        },
      ],
    });
    const result = resolvePersonality(personality({ effortLevel: "high" }), [entry]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot.thinkingOptionId).toBeUndefined();
    expect(result.snapshot.effortDegraded).toBe(true);
  });

  test("drops unknown roles and returns known roles in canonical order", () => {
    const result = resolvePersonality(
      personality({ roles: ["coder", "bogus", "chatter", "orchestrator"] }),
      [readyEntry()],
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.snapshot.roles).toEqual(["chatter", "coder", "orchestrator"]);
  });

  test("maps the retired 'worker' role to 'coder' so old personalities keep a role", () => {
    const result = resolvePersonality(personality({ roles: ["writer", "worker"] }), [readyEntry()]);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    // "worker" normalizes to "coder"; both survive in canonical order, deduped.
    expect(result.snapshot.roles).toEqual(["writer", "coder"]);
  });

  test("is unavailable when the provider is absent from the snapshot", () => {
    const result = resolvePersonality(personality(), []);
    expect(result).toEqual({
      status: "unavailable",
      code: "provider-missing",
      reason: 'Provider "openai-compat" is not configured on this host.',
    });
  });

  test("is unavailable when the provider is disabled", () => {
    const result = resolvePersonality(personality(), [readyEntry({ enabled: false })]);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.code).toBe("provider-disabled");
  });

  test("is unavailable when the provider is not ready", () => {
    const result = resolvePersonality(personality(), [
      readyEntry({ status: "loading", models: undefined, modes: undefined }),
    ]);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.code).toBe("provider-not-ready");
  });

  test("is unavailable when the bound model is gone", () => {
    const result = resolvePersonality(personality({ model: "ghost-model" }), [readyEntry()]);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.code).toBe("model-missing");
  });

  test("is unavailable when an explicit mode is missing from the provider", () => {
    const result = resolvePersonality(personality({ modeId: "ghost-mode" }), [readyEntry()]);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.code).toBe("mode-missing");
  });
});
