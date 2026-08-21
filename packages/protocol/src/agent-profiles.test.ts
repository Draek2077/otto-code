import { describe, expect, it } from "vitest";
import { AgentProfileSchema } from "./messages.js";

describe("AgentProfileSchema", () => {
  it("accepts the canonical profile settings without Otto behavior fields", () => {
    expect(
      AgentProfileSchema.parse({
        id: "reviewer",
        name: "Reviewer",
        provider: "codex",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      }),
    ).toMatchObject({ id: "reviewer", provider: "codex" });
  });

  it("preserves Otto behavior and identity fields on the canonical profile", () => {
    const profile = AgentProfileSchema.parse({
      id: "reviewer",
      name: "Reviewer",
      provider: "codex",
      model: "gpt-5.4",
      effortLevel: "high",
      personalityPrompt: "Review carefully.",
      respectGlobalAppendPrompt: false,
      roles: ["judger", "advisor"],
      spinner: { glowA: "#112233", glowB: "#445566" },
      voice: { provider: "local", model: "kokoro", name: "af_heart" },
      voiceCues: { thinking: ["Taking a closer look."] },
      memoryEnabled: false,
    });

    expect(profile.roles).toEqual(["judger", "advisor"]);
    expect(profile.personalityPrompt).toBe("Review carefully.");
    expect(profile.respectGlobalAppendPrompt).toBe(false);
    expect(profile.spinner?.glowA).toBe("#112233");
    expect(profile.voice?.name).toBe("af_heart");
    expect(profile.voiceCues?.thinking).toEqual(["Taking a closer look."]);
    expect(profile.memoryEnabled).toBe(false);
  });
});
