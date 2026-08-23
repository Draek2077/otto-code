import { describe, expect, it } from "vitest";
import type { AgentSelectOption } from "./agent-sdk-types.js";
import { EffortResolutionError, parseEffortLevel, resolveEffortOption } from "./effort-levels.js";
import { EFFORT_LEVELS } from "@otto-code/protocol/effort";

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

  // An option that parses as no canonical rung - "ultracode" / "Ultra Code" -
  // must never be what a canonical request lands on. It is opt-in: reachable by
  // naming it exactly, never by asking for "max" and being upgraded into it.
  // The stored-template editor offers the model's own option list precisely
  // because this is the only way to pick it, so the two halves have to hold
  // together: pickable deliberately, never selected automatically.
  it("never maps a canonical level onto an off-ladder option", () => {
    for (const level of EFFORT_LEVELS) {
      let resolved: ReturnType<typeof resolveEffortOption> | null = null;
      try {
        resolved = resolveEffortOption({ requested: level, thinkingOptions: CLAUDE_OPTIONS });
      } catch {
        // "off"/"minimal" have no mapping in this set; not landing anywhere is
        // also not landing on ultracode.
        continue;
      }
      expect(resolved.optionId).not.toBe("ultracode");
    }
  });

  it("resolves ultracode only when it is asked for by name", () => {
    expect(
      resolveEffortOption({ requested: "ultracode", thinkingOptions: CLAUDE_OPTIONS }),
    ).toEqual({ optionId: "ultracode", matched: "exact-id" });
  });
});
