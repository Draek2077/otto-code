import { describe, expect, it } from "vitest";
import { buildBoundPersonality, resolveDraftKey } from "./input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
} from "@/provider-selection/provider-selection";

describe("resolveDraftKey", () => {
  it("returns a string draft key unchanged", () => {
    expect(
      resolveDraftKey({
        draftKey: "draft:key",
        selectedServerId: "host-1",
      }),
    ).toBe("draft:key");
  });

  it("resolves a computed draft key from the selected server", () => {
    expect(
      resolveDraftKey({
        draftKey: ({ selectedServerId }) => `draft:${selectedServerId ?? "none"}`,
        selectedServerId: "host-1",
      }),
    ).toBe("draft:host-1");
  });
});

describe("resolveEffectiveComposerModelId", () => {
  it("returns the selected model trimmed", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "  gpt-5.4-mini  ",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [],
        modeOptions: [],
      }),
    ).toBe("gpt-5.4-mini");
  });

  it("returns empty string when no model selected", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [],
        modeOptions: [],
      }),
    ).toBe("");
  });

  it("falls back to the provider default model when no model is selected", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [
          { provider: "codex", id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
          { provider: "codex", id: "gpt-5.4", label: "gpt-5.4", isDefault: true },
        ],
        modeOptions: [],
      }),
    ).toBe("gpt-5.4");
  });
});

describe("resolveEffectiveComposerThinkingOptionId", () => {
  const models = [
    {
      provider: "codex",
      id: "gpt-5.4",
      label: "gpt-5.4",
      isDefault: true,
      defaultThinkingOptionId: "high",
      thinkingOptions: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
  ];

  it("prefers the selected thinking option when present", () => {
    expect(
      resolveEffectiveComposerThinkingOptionId(
        {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "",
          thinkingOptionId: "medium",
          availableModels: models,
          modeOptions: [],
        },
        "gpt-5.4",
      ),
    ).toBe("medium");
  });

  it("falls back to the model default thinking option", () => {
    expect(
      resolveEffectiveComposerThinkingOptionId(
        {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "",
          thinkingOptionId: "",
          availableModels: models,
          modeOptions: [],
        },
        "gpt-5.4",
      ),
    ).toBe("high");
  });
});

describe("buildDraftComposerCommandConfig", () => {
  it("returns undefined when cwd is empty", () => {
    expect(
      buildDraftCommandConfig({
        selection: {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "",
          thinkingOptionId: "",
          availableModels: [],
          modeOptions: [],
        },
        cwd: "  ",
        effectiveModelId: "gpt-5.4",
        effectiveThinkingOptionId: "high",
      }),
    ).toBeUndefined();
  });

  it("builds the draft command config from derived composer state", () => {
    expect(
      buildDraftCommandConfig({
        selection: {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "auto",
          thinkingOptionId: "high",
          availableModels: [],
          modeOptions: [{ id: "auto", label: "Auto" }],
        },
        cwd: "/repo",
        effectiveModelId: "gpt-5.4",
        effectiveThinkingOptionId: "high",
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });
  });
});

describe("buildBoundPersonality", () => {
  const roster = [
    {
      id: "personality_builtin_sage",
      name: "Sage",
      provider: "claude",
      model: "claude-opus-4-8",
      spinner: { glowA: "#111", glowB: "#222" },
    },
  ];

  it("returns null when the draft has no bound identity", () => {
    expect(buildBoundPersonality(null, null, roster)).toBeNull();
  });

  it("resolves an inherited id against the roster rather than showing the raw id", () => {
    // A fork, a "new tab from this agent", or a workspace-setup initial value
    // supplies only an id - nothing was picked in this composer. Before the two
    // template systems converged this fell through to the id string with no
    // colours, because only the just-applied profile was consulted.
    const bound = buildBoundPersonality("personality_builtin_sage", null, roster);
    expect(bound?.selectedName).toBe("Sage");
    expect(bound?.selectedSpinner).toEqual({ glowA: "#111", glowB: "#222" });
    expect(bound?.personalities?.[0]?.provider).toBe("claude");
  });

  it("prefers the profile applied in this composer over the stored roster entry", () => {
    const applied = {
      id: "personality_builtin_sage",
      name: "Sage (edited)",
      provider: "codex",
      spinner: { glowA: "#333", glowB: "#444" },
    };
    const bound = buildBoundPersonality("personality_builtin_sage", applied as never, roster);
    expect(bound?.selectedName).toBe("Sage (edited)");
    expect(bound?.personalities?.[0]?.provider).toBe("codex");
  });

  it("keeps the chip labelled with the id while the roster is still loading", () => {
    const bound = buildBoundPersonality("personality_builtin_sage", null, null);
    expect(bound?.selectedName).toBe("personality_builtin_sage");
    expect(bound?.personalities).toBeUndefined();
    // The spawn id is bound either way - a slow config load must not silently
    // drop the identity the spawn is supposed to carry.
    expect(bound?.spawnPersonalityId).toBe("personality_builtin_sage");
  });
});
