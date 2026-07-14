import { describe, expect, it } from "vitest";
import type { AgentMode, AgentModelDefinition } from "@otto-code/protocol/agent-types";
import { coerceModeForModel, filterModesForModel, modelSupportsAutoMode } from "./mode-support";

const MODES: AgentMode[] = [
  { id: "default", label: "Always Ask" },
  { id: "auto", label: "Auto mode" },
  { id: "bypassPermissions", label: "Bypass" },
];

function model(overrides: Partial<AgentModelDefinition> = {}): AgentModelDefinition {
  return { provider: "claude", id: "claude-opus-4-8", label: "Opus 4.8", ...overrides };
}

describe("modelSupportsAutoMode", () => {
  it("only an explicit false blocks auto (absent = supported/unknown/old daemon)", () => {
    expect(modelSupportsAutoMode(model())).toBe(true);
    expect(modelSupportsAutoMode(model({ supportsAutoMode: true }))).toBe(true);
    expect(modelSupportsAutoMode(model({ supportsAutoMode: false }))).toBe(false);
    expect(modelSupportsAutoMode(null)).toBe(true);
    expect(modelSupportsAutoMode(undefined)).toBe(true);
  });
});

describe("filterModesForModel", () => {
  it("hides the auto mode for models stamped unsupported", () => {
    const filtered = filterModesForModel(MODES, model({ supportsAutoMode: false }));
    expect(filtered.map((mode) => mode.id)).toEqual(["default", "bypassPermissions"]);
  });

  it("returns the list untouched when supported or model unknown", () => {
    expect(filterModesForModel(MODES, model())).toBe(MODES);
    expect(filterModesForModel(MODES, null)).toBe(MODES);
  });
});

describe("coerceModeForModel", () => {
  it("drops auto to the provider's guardrailed unattended mode for unsupported models", () => {
    // Claude Auto → dontAsk (runs without prompting, denies non-pre-approved),
    // not the provider default "Always Ask".
    expect(coerceModeForModel("auto", model({ supportsAutoMode: false }))).toBe("dontAsk");
  });

  it("leaves other modes and supported models alone", () => {
    expect(coerceModeForModel("auto", model())).toBe("auto");
    expect(coerceModeForModel("bypassPermissions", model({ supportsAutoMode: false }))).toBe(
      "bypassPermissions",
    );
  });
});
