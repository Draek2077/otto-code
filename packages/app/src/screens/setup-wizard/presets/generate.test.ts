import { describe, expect, it } from "vitest";
import type { AgentMode, AgentModelDefinition } from "@otto-code/protocol/agent-types";
import { normalizePersonalityRoles } from "@otto-code/protocol/agent-personalities";
import { TEAM_BLUEPRINTS, findBlueprint } from "./blueprints";
import { VARIATIONS } from "./variations";
import { generateTeam, makeRng, resolveTierModels } from "./generate";

const CLAUDE_MODELS: AgentModelDefinition[] = [
  { provider: "claude", id: "claude-opus-4-8", label: "Opus 4.8", contextWindowMaxTokens: 200_000 },
  { provider: "claude", id: "claude-sonnet-5", label: "Sonnet 5", contextWindowMaxTokens: 200_000 },
  {
    provider: "claude",
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    contextWindowMaxTokens: 200_000,
  },
];

const CLAUDE_MODES: AgentMode[] = [
  { id: "auto", label: "Auto" },
  { id: "plan", label: "Plan" },
  { id: "acceptEdits", label: "Accept edits" },
  { id: "default", label: "Default" },
];

describe("themed-preset content integrity", () => {
  it("has three variations for every slot of every blueprint", () => {
    for (const blueprint of TEAM_BLUEPRINTS) {
      const slotVariations = VARIATIONS[blueprint.id];
      expect(slotVariations, `variations for ${blueprint.id}`).toBeDefined();
      for (const slot of blueprint.slots) {
        expect(slotVariations[slot.slot]?.length, `${blueprint.id}/${slot.slot}`).toBe(3);
      }
    }
  });

  it("gives every blueprint exactly one orchestrator", () => {
    for (const blueprint of TEAM_BLUEPRINTS) {
      const orchestrators = blueprint.slots.filter((slot) => slot.roles.includes("orchestrator"));
      expect(orchestrators.length, blueprint.id).toBe(1);
    }
  });

  it("keeps coders out of User-lens blueprints", () => {
    for (const blueprint of TEAM_BLUEPRINTS.filter((entry) => entry.lens === "user")) {
      const coders = blueprint.slots.filter((slot) => slot.roles.includes("coder"));
      expect(coders.length, blueprint.id).toBe(0);
    }
  });
});

describe("resolveTierModels", () => {
  it("uses the shipped catalog for known models", () => {
    expect(resolveTierModels(CLAUDE_MODELS)).toEqual({
      deep: "claude-opus-4-8",
      standard: "claude-sonnet-5",
      fast: "claude-haiku-4-5",
    });
  });

  it("trusts the daemon-stamped model.tier over inference", () => {
    // A model the catalog would call "fast", explicitly stamped "deep" by the
    // daemon (e.g. via a user override at ingest), must resolve as deep.
    const models: AgentModelDefinition[] = [
      { provider: "claude", id: "claude-haiku-4-5", label: "Haiku", tier: "deep" },
      { provider: "claude", id: "claude-sonnet-5", label: "Sonnet" },
    ];
    expect(resolveTierModels(models)?.deep).toBe("claude-haiku-4-5");
  });

  it("falls back to a context-window heuristic for unclassifiable models", () => {
    const models: AgentModelDefinition[] = [
      { provider: "openai-compatible", id: "big", label: "Big", contextWindowMaxTokens: 128_000 },
      { provider: "openai-compatible", id: "mid", label: "Mid", contextWindowMaxTokens: 32_000 },
      { provider: "openai-compatible", id: "small", label: "Small", contextWindowMaxTokens: 8_000 },
    ];
    expect(resolveTierModels(models)).toEqual({ deep: "big", standard: "mid", fast: "small" });
  });

  it("does NOT guess unknown local models by name — they fall to the heuristic", () => {
    // Arbitrary HF ids are not in the catalog, so name/size is ignored; the
    // context-window heuristic (biggest = deep) is the only signal left.
    const models: AgentModelDefinition[] = [
      {
        provider: "openai-compatible",
        id: "Qwen2.5-72B",
        label: "72B",
        contextWindowMaxTokens: 8_000,
      },
      {
        provider: "openai-compatible",
        id: "Qwen2.5-7B",
        label: "7B",
        contextWindowMaxTokens: 128_000,
      },
    ];
    // The "7B" wins deep purely on context window — proof we don't read the name.
    expect(resolveTierModels(models)?.deep).toBe("Qwen2.5-7B");
  });

  it("distinguishes catalog siblings like gpt-5 vs gpt-5-mini", () => {
    const models: AgentModelDefinition[] = [
      { provider: "openai-compatible", id: "gpt-5", label: "GPT-5" },
      { provider: "openai-compatible", id: "gpt-5-mini", label: "GPT-5 mini" },
    ];
    const resolved = resolveTierModels(models);
    expect(resolved?.deep).toBe("gpt-5");
    expect(resolved?.fast).toBe("gpt-5-mini");
  });

  it("lets a user tag win, but only if the model still exists", () => {
    const models: AgentModelDefinition[] = [
      { provider: "openai-compatible", id: "model-a", label: "A", contextWindowMaxTokens: 8_000 },
      { provider: "openai-compatible", id: "model-b", label: "B", contextWindowMaxTokens: 4_000 },
    ];
    // A user tag on model-b as deep beats the context-window heuristic.
    expect(resolveTierModels(models, { "model-b": "deep" })?.deep).toBe("model-b");
    // A tag on a model that no longer exists is simply inert (heuristic stands).
    expect(resolveTierModels(models, { deleted: "deep" })?.deep).toBe("model-a");
  });

  it("returns null when the provider advertises no models", () => {
    expect(resolveTierModels([])).toBeNull();
    expect(resolveTierModels(undefined)).toBeNull();
  });
});

describe("generateTeam", () => {
  const blueprint = findBlueprint("dev_application")!;

  it("produces a role-complete, provider-valid team", () => {
    const result = generateTeam({
      blueprint,
      provider: "claude",
      models: CLAUDE_MODELS,
      modes: CLAUDE_MODES,
      random: makeRng(1),
    });
    expect(result).not.toBeNull();
    const { personalities, team } = result!;

    // One member per slot, all wired into the team in order.
    expect(personalities).toHaveLength(blueprint.slots.length);
    expect(team.memberIds).toEqual(personalities.map((p) => p.id));

    // Every member binds an advertised model + resolvable roles + a prompt.
    const modelIds = new Set(CLAUDE_MODELS.map((m) => m.id));
    for (const personality of personalities) {
      expect(modelIds.has(personality.model)).toBe(true);
      expect(normalizePersonalityRoles(personality.roles).length).toBeGreaterThan(0);
      expect(personality.personalityPrompt && personality.personalityPrompt.length).toBeTruthy();
    }

    // Names are unique within the team.
    const names = personalities.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);

    // The lead resolves to the deep (opus) brain and an advertised mode.
    const lead = personalities[0];
    expect(lead.model).toBe("claude-opus-4-8");
    expect(lead.modeId && CLAUDE_MODES.some((mode) => mode.id === lead.modeId)).toBeTruthy();
  });

  it("is deterministic for a fixed seed", () => {
    const a = generateTeam({
      blueprint,
      provider: "claude",
      models: CLAUDE_MODELS,
      modes: CLAUDE_MODES,
      random: makeRng(42),
    });
    const b = generateTeam({
      blueprint,
      provider: "claude",
      models: CLAUDE_MODELS,
      modes: CLAUDE_MODES,
      random: makeRng(42),
    });
    // Personas + names + colors match; only ids differ (random token per call).
    const strip = (t: NonNullable<typeof a>) =>
      t.personalities.map((p) => ({
        name: p.name,
        model: p.model,
        prompt: p.personalityPrompt,
        spinner: p.spinner,
      }));
    expect(strip(a!)).toEqual(strip(b!));
  });

  it("returns null when the provider has no models to bind", () => {
    expect(
      generateTeam({ blueprint, provider: "claude", models: [], modes: CLAUDE_MODES }),
    ).toBeNull();
  });

  it("binds real models with a mode-less provider, leaving modeId unset", () => {
    const result = generateTeam({
      blueprint,
      provider: "openai-compatible",
      models: [
        {
          provider: "openai-compatible",
          id: "local-large",
          label: "Large",
          contextWindowMaxTokens: 64_000,
        },
      ],
      modes: [],
      random: makeRng(7),
    });
    expect(result).not.toBeNull();
    for (const personality of result!.personalities) {
      expect(personality.model).toBe("local-large");
      expect(personality.modeId).toBeUndefined();
    }
  });
});
