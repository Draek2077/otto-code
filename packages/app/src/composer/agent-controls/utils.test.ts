import { describe, expect, it } from "vitest";
import {
  formatAgentModeLabel,
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  getModeTierColor,
  hexColorWithAlpha,
  formatThinkingOptionLabel,
  normalizeModelId,
  resolveAgentModelSelection,
  resolveRuntimeModelFact,
  type ModeTierColors,
} from "./utils";

describe("getAgentControlHintKey", () => {
  it("returns translation keys for each editable agent control hint", () => {
    expect(getAgentControlHintKey("thinking")).toBe("agentControls.hints.thinking");
    expect(getAgentControlHintKey("model")).toBe("agentControls.hints.model");
    expect(getAgentControlHintKey("mode")).toBe("agentControls.hints.mode");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });
});

describe("getModeTierColor", () => {
  const palette: ModeTierColors = {
    safe: "green",
    moderate: "yellow",
    dangerous: "red",
    planning: "blue",
  };

  it("maps named tiers to their palette colors", () => {
    expect(getModeTierColor("safe", palette)).toBe("green");
    expect(getModeTierColor("moderate", palette)).toBe("yellow");
    expect(getModeTierColor("dangerous", palette)).toBe("red");
    expect(getModeTierColor("planning", palette)).toBe("blue");
  });

  it("passes hex tiers through unchanged", () => {
    expect(getModeTierColor("#ff6b6b", palette)).toBe("#ff6b6b");
  });

  it("returns undefined for neutral, unknown, and missing tiers", () => {
    expect(getModeTierColor("neutral", palette)).toBeUndefined();
    expect(getModeTierColor("mystery", palette)).toBeUndefined();
    expect(getModeTierColor(undefined, palette)).toBeUndefined();
  });
});

describe("hexColorWithAlpha", () => {
  it("appends the alpha channel to 6-digit hex colors", () => {
    expect(hexColorWithAlpha("#dc2626", 0.5)).toBe("#dc262680");
    expect(hexColorWithAlpha("#38BDF8", 1)).toBe("#38BDF8ff");
    expect(hexColorWithAlpha("#38bdf8", 0)).toBe("#38bdf800");
  });

  it("expands 3-digit hex colors before appending alpha", () => {
    expect(hexColorWithAlpha("#f00", 0.5)).toBe("#ff000080");
  });

  it("returns undefined for non-hex colors", () => {
    expect(hexColorWithAlpha("red", 0.5)).toBeUndefined();
    expect(hexColorWithAlpha("rgba(0,0,0,1)", 0.5)).toBeUndefined();
    expect(hexColorWithAlpha("#dc26", 0.5)).toBeUndefined();
  });
});

describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("formatAgentModeLabel", () => {
  it("sentence-cases provider mode labels", () => {
    expect(formatAgentModeLabel({ id: "plan", label: "Plan" })).toBe("Plan");
    expect(formatAgentModeLabel({ id: "full-access", label: "Full Access" })).toBe("Full access");
    expect(formatAgentModeLabel({ id: "auto-review", label: "Auto-review" })).toBe("Auto-review");
    expect(formatAgentModeLabel({ id: "read_only", label: "read_only" })).toBe("Read only");
    expect(formatAgentModeLabel({ id: "acceptEdits", label: "acceptEdits" })).toBe("Accept edits");
  });

  it("splits compact mode ids when no provider label is available", () => {
    expect(formatAgentModeLabel({ id: "auto-review" })).toBe("Auto review");
  });
});

describe("formatThinkingOptionLabel", () => {
  it("formats compact thinking option labels for display", () => {
    expect(formatThinkingOptionLabel({ id: "none", label: "none" })).toBe("None");
    expect(formatThinkingOptionLabel({ id: "low", label: "low" })).toBe("Low");
    expect(formatThinkingOptionLabel({ id: "medium", label: "medium" })).toBe("Medium");
    expect(formatThinkingOptionLabel({ id: "high", label: "high" })).toBe("High");
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "xhigh" })).toBe("Extra high");
  });

  it("sentence-cases split provider labels", () => {
    expect(formatThinkingOptionLabel({ id: "extra_high", label: "extra_high" })).toBe("Extra high");
    expect(formatThinkingOptionLabel({ id: "think-hard", label: "think-hard" })).toBe("Think hard");
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "XHigh" })).toBe("Extra high");
  });
});

describe("resolveRuntimeModelFact", () => {
  const models = [
    { id: "claude-opus-5", provider: "claude" as const, label: "Opus 5" },
    { id: "claude-fable-5", provider: "claude" as const, label: "Fable 5" },
  ];

  // The Auto case: the picker shows the configured Fable, the CLI ran Opus, and
  // this is now the only place that says so.
  it("names the model that ran when it differs from the selection", () => {
    expect(
      resolveRuntimeModelFact({
        models,
        runtimeModelId: "claude-opus-5",
        selectedModelId: "claude-fable-5",
      }),
    ).toBe("Opus 5");
  });

  it("says nothing when the runtime model is the selection", () => {
    expect(
      resolveRuntimeModelFact({
        models,
        runtimeModelId: "claude-fable-5",
        selectedModelId: "claude-fable-5",
      }),
    ).toBeNull();
  });

  it("says nothing before a turn has run", () => {
    expect(
      resolveRuntimeModelFact({
        models,
        runtimeModelId: null,
        selectedModelId: "claude-fable-5",
      }),
    ).toBeNull();
  });

  // A raw dated id is usually the same model under another name, so naming it
  // would report a difference that isn't one.
  it("says nothing when the runtime model is not in the catalog", () => {
    expect(
      resolveRuntimeModelFact({
        models,
        runtimeModelId: "claude-opus-5-20260101",
        selectedModelId: "claude-fable-5",
      }),
    ).toBeNull();
  });

  it("returns a label, never an id, so it can never be fed back as a selection", () => {
    const fact = resolveRuntimeModelFact({
      models,
      runtimeModelId: "claude-opus-5",
      selectedModelId: "claude-fable-5",
    });

    expect(fact).toBe("Opus 5");
    expect(models.some((model) => model.id === fact)).toBe(false);
  });
});

describe("resolveAgentModelSelection", () => {
  // The reported bug: switch Opus -> Fable mid-chat, and the picker slides back
  // to Opus on the next turn. The daemon keeps the choice in config.model, but
  // the provider goes on reporting the model it actually ran (Claude's Auto mode
  // names the CLI's per-turn pick, and any provider lags until its query
  // restarts). The user's explicit selection has to win the display.
  it("keeps the configured model when the runtime model reports a different one", () => {
    const models = [
      {
        id: "claude-opus-5",
        provider: "claude" as const,
        label: "Opus 5",
        thinkingOptions: [{ id: "high", label: "High" }],
      },
      {
        id: "claude-fable-5",
        provider: "claude" as const,
        label: "Fable 5",
        thinkingOptions: [{ id: "high", label: "High" }],
      },
    ];

    const selection = resolveAgentModelSelection({
      models,
      runtimeModelId: "claude-opus-5",
      configuredModelId: "claude-fable-5",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("claude-fable-5");
    expect(selection.displayModel).toBe("Fable 5");
  });

  it("falls back to the runtime model when nothing is configured", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "claude-opus-5",
          provider: "claude",
          label: "Opus 5",
          thinkingOptions: [{ id: "high", label: "High" }],
        },
      ],
      runtimeModelId: "claude-opus-5",
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("claude-opus-5");
    expect(selection.displayModel).toBe("Opus 5");
  });

  it("prefers runtime model over a configured model absent from the catalog", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("a");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("Extra high");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("Low");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("Low");
  });
});
