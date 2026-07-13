import { describe, expect, test } from "vitest";

import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSchedulerSnapshot,
  resolveTeamSnapshotForPersonality,
} from "./agent-teams.js";
import type { AgentTeamsConfigView } from "@otto-code/protocol/agent-teams";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";

const crew = {
  id: "team-crew",
  name: "Shipping crew",
  avatar: { color: "#4ec4ff" },
  teamPrompt: "Work as a coordinated crew.",
  memberIds: ["p-atlas", "p-dash"],
};

const activeCrew: AgentTeamsConfigView = { teams: [crew], activeTeamId: "team-crew" };

describe("resolveTeamSnapshotForPersonality", () => {
  test("a member of the active team resolves the frozen team layer", () => {
    expect(resolveTeamSnapshotForPersonality(activeCrew, "p-atlas")).toEqual({
      teamId: "team-crew",
      name: "Shipping crew",
      avatarColor: "#4ec4ff",
      teamPrompt: "Work as a coordinated crew.",
    });
  });

  test.each([
    ["raw spawn (no personality)", activeCrew, undefined],
    ["non-member personality", activeCrew, "p-vera"],
    ["no active team", { teams: [crew] } satisfies AgentTeamsConfigView, "p-atlas"],
    ["null active team", { teams: [crew], activeTeamId: null }, "p-atlas"],
    ["dangling active id", { teams: [crew], activeTeamId: "team-gone" }, "p-atlas"],
    ["absent section", undefined, "p-atlas"],
  ])("no team layer: %s", (_label, section, personalityId) => {
    expect(resolveTeamSnapshotForPersonality(section, personalityId)).toBeNull();
  });

  test("a whitespace team prompt resolves an organizational team (no prompt field)", () => {
    const section: AgentTeamsConfigView = {
      teams: [{ ...crew, teamPrompt: "   \n " }],
      activeTeamId: "team-crew",
    };
    expect(resolveTeamSnapshotForPersonality(section, "p-atlas")).toEqual({
      teamId: "team-crew",
      name: "Shipping crew",
      avatarColor: "#4ec4ff",
    });
  });

  test("the team prompt is trimmed into the snapshot", () => {
    const section: AgentTeamsConfigView = {
      teams: [{ ...crew, teamPrompt: "  Frame the crew.  " }],
      activeTeamId: "team-crew",
    };
    expect(resolveTeamSnapshotForPersonality(section, "p-dash")?.teamPrompt).toBe(
      "Frame the crew.",
    );
  });
});

describe("resolveTeamSchedulerSnapshot", () => {
  function makeScheduler(overrides: Partial<AgentPersonality> & { id: string }): AgentPersonality {
    return {
      name: overrides.id,
      provider: "codex",
      model: "gpt-5.4-mini",
      roles: ["scheduler"],
      ...overrides,
    };
  }

  const readyEntries: ProviderSnapshotEntry[] = [
    {
      provider: "codex",
      status: "ready",
      enabled: true,
      models: [{ provider: "codex", id: "gpt-5.4-mini", label: "GPT-5.4 Mini" }],
      modes: [],
    },
  ];

  const dash = makeScheduler({ id: "p-dash", name: "Dash" });
  const luna = makeScheduler({ id: "p-luna", name: "Luna", provider: "not-connected" });
  const vera = makeScheduler({ id: "p-vera", name: "Vera", roles: ["judger"] });

  test("resolves the first available Scheduler in member order", () => {
    const snapshot = resolveTeamSchedulerSnapshot({
      agentTeams: {
        teams: [{ id: "t", name: "Crew", memberIds: ["p-luna", "p-dash"] }],
        activeTeamId: "t",
      },
      roster: [dash, luna],
      entries: readyEntries,
    });
    // Luna (member order first) is unavailable; Dash wins.
    expect(snapshot.personalityId).toBe("p-dash");
  });

  test("hard-fails when no team is active", () => {
    expect(() =>
      resolveTeamSchedulerSnapshot({
        agentTeams: { teams: [], activeTeamId: null },
        roster: [dash],
        entries: readyEntries,
      }),
    ).toThrow(/no team is active/);
  });

  test("hard-fails when the team has no Scheduler-role member", () => {
    expect(() =>
      resolveTeamSchedulerSnapshot({
        agentTeams: {
          teams: [{ id: "t", name: "Crew", memberIds: ["p-vera"] }],
          activeTeamId: "t",
        },
        roster: [vera],
        entries: readyEntries,
      }),
    ).toThrow(/no member with the Scheduler role/);
  });

  test("hard-fails with the first reason when every Scheduler is unavailable", () => {
    expect(() =>
      resolveTeamSchedulerSnapshot({
        agentTeams: {
          teams: [{ id: "t", name: "Crew", memberIds: ["p-luna"] }],
          activeTeamId: "t",
        },
        roster: [luna],
        entries: readyEntries,
      }),
    ).toThrow(/no Scheduler in team "Crew" is available \(Luna:/);
  });
});

describe("composeTeamAndPersonalityPrompt", () => {
  test("team prompt stacks directly ahead of the personality prompt", () => {
    expect(composeTeamAndPersonalityPrompt({ teamPrompt: "Team frame." }, "You are Vera.")).toBe(
      "Team frame.\n\nYou are Vera.",
    );
  });

  test("no team layer passes the personality prompt through verbatim", () => {
    expect(composeTeamAndPersonalityPrompt(null, "You are Vera.")).toBe("You are Vera.");
    expect(composeTeamAndPersonalityPrompt(undefined, undefined)).toBeUndefined();
    // Legacy byte-for-byte passthrough, even for odd values.
    expect(composeTeamAndPersonalityPrompt(null, "")).toBe("");
  });

  test("a team prompt with no personality prompt stands alone", () => {
    expect(composeTeamAndPersonalityPrompt({ teamPrompt: "Team frame." }, undefined)).toBe(
      "Team frame.",
    );
    expect(composeTeamAndPersonalityPrompt({ teamPrompt: "Team frame." }, "   ")).toBe(
      "Team frame.",
    );
  });

  test("an organizational team (no prompt) composes nothing", () => {
    expect(composeTeamAndPersonalityPrompt({}, "You are Vera.")).toBe("You are Vera.");
  });
});
