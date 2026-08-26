import { describe, expect, it } from "vitest";
import { resolveKnowledgeSwitchPrompt } from "./project-settings-knowledge-section";

describe("resolveKnowledgeSwitchPrompt", () => {
  it("asks before a repository-to-host switch that would empty the working tree", () => {
    expect(
      resolveKnowledgeSwitchPrompt({ from: "repository", to: "host", hasPages: true }),
    ).toEqual({ kind: "confirm", movePrompt: "toHost" });
  });

  it("asks before a host-to-repository switch that would write into the working tree", () => {
    expect(
      resolveKnowledgeSwitchPrompt({ from: "host", to: "repository", hasPages: true }),
    ).toEqual({ kind: "confirm", movePrompt: "toRepository" });
  });

  it("switches silently when there is nothing to carry across", () => {
    expect(
      resolveKnowledgeSwitchPrompt({ from: "repository", to: "host", hasPages: false }),
    ).toEqual({ kind: "switch" });
  });

  it("switches silently when the location does not actually change", () => {
    // Picking "Repository" on a project already resolving to the repository
    // pins the choice without moving anything, so there is nothing to ask.
    expect(
      resolveKnowledgeSwitchPrompt({ from: "repository", to: "repository", hasPages: true }),
    ).toEqual({ kind: "switch" });
  });
});
