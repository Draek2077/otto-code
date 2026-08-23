import { describe, expect, test } from "vitest";
import type {
  StructuredTextGeneration,
  StructuredTextGenerationRequest,
} from "../session/checkout/git-metadata-generator.js";
import { StructuredAgentResponseError } from "./agent-response-loop.js";
import {
  createPersonalityProfileGenerator,
  describeGlowColor,
} from "./profile-prompt-generator.js";

const PARTS = {
  pronouns: "she/her",
  archetype: "a former archivist who cannot leave a loose end alone",
  traits: [
    "Reads the failing test before touching the code.",
    "Names the file and line for every claim she makes.",
    "Says 'not found' rather than guessing.",
  ],
  teamwork: "Hands off with a written summary and asks for the same back.",
  speech: "Dry, precise, one clause more than strictly needed.",
  quirk: "Numbers her findings out loud.",
  motto: "Show me where.",
};

function fakeGeneration(handler: (request: StructuredTextGenerationRequest<unknown>) => unknown): {
  generation: Pick<StructuredTextGeneration, "generate">;
  calls: number;
} {
  const state = { calls: 0 };
  const generation: Pick<StructuredTextGeneration, "generate"> = {
    generate: async <T>(request: StructuredTextGenerationRequest<T>): Promise<T> => {
      state.calls += 1;
      return handler(request as StructuredTextGenerationRequest<unknown>) as T;
    },
  };
  return {
    generation,
    get calls() {
      return state.calls;
    },
  };
}

describe("describeGlowColor", () => {
  test("turns hex into a plain-language color phrase", () => {
    expect(describeGlowColor("#4ec4ff")).toBe("vivid azure");
    expect(describeGlowColor("#e14fe8")).toBe("vivid magenta");
    expect(describeGlowColor("#111111")).toBe("near-black");
  });

  test("accepts shorthand and alpha forms, rejects junk", () => {
    expect(describeGlowColor("#0f0")).toBe("vivid green");
    expect(describeGlowColor("#4ec4ffcc")).toBe("vivid azure");
    expect(describeGlowColor("not-a-color")).toBeNull();
  });
});

describe("createPersonalityProfileGenerator", () => {
  test("teaches the model what a great holder of each role is like", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.prompt).toContain("Nova");
      // The role's job…
      expect(request.prompt).toContain("Read-only surveyor");
      // …and the virtues a good one has, which is what keeps the character fit
      // for the role instead of merely colorful.
      expect(request.prompt).toContain("would rather say 'not found' than guess");
      expect(request.prompt).toContain("no researcher who rushes");
      return PARTS;
    });
    const generator = createPersonalityProfileGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    await generator.generate({ name: "Nova", roles: ["researcher"] });
    expect(fake.calls).toBe(1);
  });

  test("hands the palette over in words and forbids color talk in the profile", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.prompt).toContain("vivid azure shading into vivid magenta");
      expect(request.prompt).not.toContain("#4ec4ff");
      expect(request.prompt).toContain("NEVER mention colors");
      return PARTS;
    });
    const generator = createPersonalityProfileGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    await generator.generate({ name: "Nova", glowA: "#4ec4ff", glowB: "#e14fe8" });
  });

  test("assembles the parts into a second-person profile", async () => {
    const fake = fakeGeneration(() => PARTS);
    const generator = createPersonalityProfileGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    const profile = await generator.generate({ name: "Nova", roles: ["researcher"] });
    expect(profile).toBe(
      [
        "You are Nova (she/her), a former archivist who cannot leave a loose end alone.",
        "",
        "How you work:",
        "- Reads the failing test before touching the code.",
        "- Names the file and line for every claim she makes.",
        "- Says 'not found' rather than guessing.",
        "",
        "With the team: Hands off with a written summary and asks for the same back.",
        "",
        "How you talk: Dry, precise, one clause more than strictly needed.",
        "",
        "Quirk: Numbers her findings out loud.",
        "",
        'You live by: "Show me where."',
      ].join("\n"),
    );
  });

  test("falls back to the provided cwd when none is passed", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.cwd).toBe("/repo");
      return PARTS;
    });
    const generator = createPersonalityProfileGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    await generator.generate({ name: "Nova" });
    expect(fake.calls).toBe(1);
  });

  test("returns null when generation fails with a structured error", async () => {
    const fake = fakeGeneration(() => {
      throw new StructuredAgentResponseError("generation failed", {
        lastResponse: "",
        validationErrors: [],
      });
    });
    const generator = createPersonalityProfileGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    expect(await generator.generate({ name: "Nova" })).toBeNull();
  });
});
