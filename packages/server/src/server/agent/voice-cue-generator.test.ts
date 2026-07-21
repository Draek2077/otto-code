import { describe, expect, test } from "vitest";
import type {
  StructuredTextGeneration,
  StructuredTextGenerationRequest,
} from "../session/checkout/git-metadata-generator.js";
import { StructuredAgentResponseError } from "./agent-response-loop.js";
import { createVoiceCueGenerator, type VoiceCueLines } from "./voice-cue-generator.js";

const SAMPLE: VoiceCueLines = {
  join: ["On it", "Let's go"],
  thinking: ["Thinking", "Let me see"],
  waiting: ["Helpers still out", "Idling a moment"],
  done: ["All set", "Done"],
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

describe("createVoiceCueGenerator", () => {
  test("passes the persona name + prompt + roles into the writer prompt", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.prompt).toContain("Nova");
      expect(request.prompt).toContain("Warm and upbeat.");
      expect(request.prompt).toContain("researcher");
      expect(request.prompt).toContain("planner");
      return SAMPLE;
    });
    const generator = createVoiceCueGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    const cues = await generator.generate({
      name: "Nova",
      prompt: "Warm and upbeat.",
      roles: ["researcher", "planner"],
      cwd: "/work",
    });
    expect(cues).toEqual(SAMPLE);
    expect(fake.calls).toBe(1);
  });

  test("falls back to the provided cwd when none is passed", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.cwd).toBe("/repo");
      return SAMPLE;
    });
    const generator = createVoiceCueGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    await generator.generate({ name: "Nova" });
    expect(fake.calls).toBe(1);
  });

  test("authors a single moment with a focused prompt and returns only that group", async () => {
    const fake = fakeGeneration((request) => {
      // The focused prompt names the one moment and omits the others.
      expect(request.prompt).toContain("COMPLETED");
      expect(request.prompt).not.toContain("STARTING");
      expect(request.prompt).not.toContain("THINKING");
      expect(request.prompt).not.toContain("WAITING");
      return { lines: ["Done", "Wrapped up"] };
    });
    const generator = createVoiceCueGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    const cues = await generator.generate({ name: "Nova", moment: "done" });
    expect(cues).toEqual({ join: [], thinking: [], waiting: [], done: ["Done", "Wrapped up"] });
    expect(fake.calls).toBe(1);
  });

  test("authors the waiting moment as sub-agents-still-running, not finality", async () => {
    const fake = fakeGeneration((request) => {
      expect(request.prompt).toContain("WAITING");
      expect(request.prompt).not.toContain("COMPLETED");
      return { lines: ["Helpers still out"] };
    });
    const generator = createVoiceCueGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    const cues = await generator.generate({ name: "Nova", moment: "waiting" });
    expect(cues).toEqual({ join: [], thinking: [], waiting: ["Helpers still out"], done: [] });
  });

  test("returns null when generation fails with a structured error", async () => {
    const fake = fakeGeneration(() => {
      throw new StructuredAgentResponseError("generation failed", {
        lastResponse: "",
        validationErrors: [],
      });
    });
    const generator = createVoiceCueGenerator({
      generation: fake.generation,
      fallbackCwd: () => "/repo",
    });

    expect(await generator.generate({ name: "Nova" })).toBeNull();
  });
});
