import { describe, expect, it } from "vitest";
import type { AgentMode } from "@otto-code/protocol/agent-types";
import { resolveAgentControlsMode, resolveModeSelection, resolveNextAgentModeId } from "./mode";

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        onSelectProvider: () => undefined,
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});

// Claude's mode set, where "dontAsk" is flagged userSelectable:false in the manifest.
const CLAUDE_MODES = [
  { id: "default", label: "Always Ask" },
  { id: "auto", label: "Auto mode" },
  { id: "dontAsk", label: "Don't Ask" },
  { id: "bypassPermissions", label: "Bypass" },
] satisfies AgentMode[];

describe("resolveModeSelection", () => {
  it("excludes non-user-selectable modes from the selectable set", () => {
    const { selectableModes } = resolveModeSelection({
      provider: "claude",
      modeOptions: CLAUDE_MODES,
      selectedModeId: "default",
      lockNonSelectable: true,
    });
    expect(selectableModes.map((m) => m.id)).toEqual(["default", "auto", "bypassPermissions"]);
  });

  it("resolves a hidden active mode from the full set and locks it when locking is on", () => {
    const { selectedMode, isLocked } = resolveModeSelection({
      provider: "claude",
      modeOptions: CLAUDE_MODES,
      selectedModeId: "dontAsk",
      lockNonSelectable: true,
    });
    expect(selectedMode?.id).toBe("dontAsk");
    expect(isLocked).toBe(true);
  });

  it("shows a hidden active mode without locking on a non-locking surface", () => {
    const { selectedMode, isLocked } = resolveModeSelection({
      provider: "claude",
      modeOptions: CLAUDE_MODES,
      selectedModeId: "dontAsk",
      lockNonSelectable: false,
    });
    expect(selectedMode?.id).toBe("dontAsk");
    expect(isLocked).toBe(false);
  });

  it("falls back to the first selectable mode for an unknown selection (never a hidden one)", () => {
    const { selectedMode, isLocked } = resolveModeSelection({
      provider: "claude",
      modeOptions: [
        { id: "dontAsk", label: "Don't Ask" },
        { id: "default", label: "Always Ask" },
      ],
      selectedModeId: "ghost",
      lockNonSelectable: true,
    });
    expect(selectedMode?.id).toBe("default");
    expect(isLocked).toBe(false);
  });

  it("returns no selected mode for an empty set", () => {
    const selection = resolveModeSelection({
      provider: "claude",
      modeOptions: [],
      selectedModeId: "default",
      lockNonSelectable: true,
    });
    expect(selection.selectedMode).toBeNull();
    expect(selection.isLocked).toBe(false);
  });
});
