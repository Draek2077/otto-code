import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated workflow", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-Draek2077",
              accountLogin: "Draek2077",
              accountType: "Organization",
              repositories: ["Draek2077/otto-code"],
            },
          ],
          slack: [{ teamId: "T123", teamName: "Otto" }],
          discord: [{ guildId: "456", guildName: "Otto Discord" }],
        },
        "Draek2077/otto-code",
      ),
    ).toEqual([
      {
        id: "github:Draek2077/otto-code",
        label: "GitHub — Draek2077/otto-code",
        provider: "github",
        filters: { repo: "Draek2077/otto-code" },
      },
      {
        id: "slack:T123",
        label: "Slack — Otto",
        provider: "slack",
        filters: { workspace: "T123" },
      },
      {
        id: "discord:456",
        label: "Discord — Otto Discord",
        provider: "discord",
        filters: { guild: "456" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-Draek2077",
              accountLogin: "Draek2077",
              accountType: "Organization",
              repositories: ["Draek2077/hub"],
            },
          ],
          slack: [],
          discord: [],
        },
        "Draek2077/otto-code",
      ),
    ).toEqual([]);
  });
});
