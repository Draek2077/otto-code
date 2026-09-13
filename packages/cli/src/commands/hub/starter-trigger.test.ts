import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
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
          slack: [{ slug: "paseo", teamName: "Paseo" }],
          discord: [{ slug: "paseo-discord", guildName: "Paseo Discord" }],
          daemons: [],
          linear: [],
        },
        "Draek2077/otto-code",
      ),
    ).toEqual([
      {
        id: "github:Draek2077/otto-code",
        label: "GitHub — Draek2077/otto-code",
        provider: "github",
        filters: { connection: "github-Draek2077", repo: "Draek2077/otto-code" },
      },
      {
        id: "slack:paseo",
        label: "Slack — Paseo",
        provider: "slack",
        filters: { connection: "paseo" },
      },
      {
        id: "discord:paseo-discord",
        label: "Discord — Paseo Discord",
        provider: "discord",
        filters: { connection: "paseo-discord" },
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
          daemons: [],
          linear: [],
        },
        "Draek2077/otto-code",
      ),
    ).toEqual([]);
  });
});
