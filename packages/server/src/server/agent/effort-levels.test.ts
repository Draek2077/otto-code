import { describe, expect, it } from "vitest";
import type { AgentSelectOption } from "./agent-sdk-types.js";
import { EffortResolutionError, parseEffortLevel, resolveEffortOption } from "./effort-levels.js";

const CLAUDE_OPTIONS: AgentSelectOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
  { id: "ultracode", label: "Ultra Code" },
];

const OPENAI_COMPAT_OPTIONS: AgentSelectOption[] = [
  { id: "off", label: "Off", isDefault: true },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const CUSTOM_OPTIONS: AgentSelectOption[] = [
  { id: "variant-a", label: "Variant A" },
  { id: "variant-b", label: "Variant B" },
];

describe("parseEffortLevel", () => {
  it("normalizes synonyms, case, and separators", () => {
    expect(parseEffortLevel("Extra High")).toBe("xhigh");
    expect(parseEffortLevel("extra-high")).toBe("xhigh");
    expect(parseEffortLevel("MAXIMUM")).toBe("max");
    expect(parseEffortLevel("none")).toBe("off");
    expect(parseEffortLevel("min")).toBe("minimal");
  });

  it("returns null for values outside the scale", () => {
    expect(parseEffortLevel("ultracode")).toBeNull();
    expect(parseEffortLevel("turbo")).toBeNull();
  });
});

describe("resolveEffortOption", () => {
  it("prefers an exact option id, including ids off the canonical scale", () => {
    expect(
      resolveEffortOption({ requested: "ultracode", thinkingOptions: CLAUDE_OPTIONS }),
    ).toEqual({ optionId: "ultracode", matched: "exact-id" });
  });

  it("matches option ids case-insensitively", () => {
    expect(resolveEffortOption({ requested: "High", thinkingOptions: CLAUDE_OPTIONS })).toEqual({
      optionId: "high",
      matched: "exact-id",
    });
  });

  it("resolves a canonical level the model offers", () => {
    expect(
      resolveEffortOption({ requested: "extra high", thinkingOptions: CLAUDE_OPTIONS }),
    ).toEqual({ optionId: "xhigh", matched: "level" });
  });

  it("clamps to the nearest supported level", () => {
    expect(
      resolveEffortOption({ requested: "xhigh", thinkingOptions: OPENAI_COMPAT_OPTIONS }),
    ).toEqual({ optionId: "high", matched: "nearest" });
    expect(resolveEffortOption({ requested: "off", thinkingOptions: CLAUDE_OPTIONS })).toEqual({
      optionId: "low",
      matched: "nearest",
    });
  });

  it("rounds ties down so it never spends more effort than requested", () => {
    const sparse: AgentSelectOption[] = [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ];
    expect(resolveEffortOption({ requested: "medium", thinkingOptions: sparse })).toEqual({
      optionId: "low",
      matched: "nearest",
    });
  });

  it("throws for unknown values, listing the available ids", () => {
    expect(() =>
      resolveEffortOption({ requested: "turbo", thinkingOptions: CLAUDE_OPTIONS }),
    ).toThrow(EffortResolutionError);
  });

  it("throws for levels when no option maps onto the scale", () => {
    expect(() =>
      resolveEffortOption({ requested: "high", thinkingOptions: CUSTOM_OPTIONS }),
    ).toThrow(EffortResolutionError);
  });

  it("still resolves exact ids for custom option sets", () => {
    expect(
      resolveEffortOption({ requested: "variant-b", thinkingOptions: CUSTOM_OPTIONS }),
    ).toEqual({ optionId: "variant-b", matched: "exact-id" });
  });
});
