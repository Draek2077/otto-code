import { describe, expect, test } from "vitest";

import {
  findAgentTeam,
  getActiveAgentTeam,
  getEffectiveTeamPrompt,
  isTeamMember,
  pruneTeamMemberIds,
  resolveExclusiveTeamMembers,
  resolveTeamMembers,
  teamRoleUnion,
} from "./agent-teams.js";
import type { AgentPersonality, AgentTeam } from "./messages.js";

function makePersonality(overrides: Partial<AgentPersonality> & { id: string }): AgentPersonality {
  return {
    name: overrides.id,
    provider: "claude",
    model: "claude-sonnet-5",
    ...overrides,
  };
}

const atlas = makePersonality({ id: "p-atlas", roles: ["orchestrator", "chatter"] });
const dash = makePersonality({ id: "p-dash", roles: ["writer", "scheduler"] });
const vera = makePersonality({ id: "p-vera", roles: ["judger"] });
const roster = [atlas, dash, vera];

const crew: AgentTeam = {
  id: "team-crew",
  name: "Shipping crew",
  teamPrompt: "Work as a coordinated crew.",
  memberIds: ["p-dash", "p-atlas", "p-deleted"],
};

describe("getActiveAgentTeam", () => {
  test("resolves the active team by id", () => {
    expect(getActiveAgentTeam({ teams: [crew], activeTeamId: "team-crew" })).toBe(crew);
  });

  test.each([
    ["absent section", undefined],
    ["no active id", { teams: [crew] }],
    ["null active id", { teams: [crew], activeTeamId: null }],
    ["dangling active id", { teams: [crew], activeTeamId: "team-gone" }],
    ["empty teams", { teams: [], activeTeamId: "team-crew" }],
  ])("reads as no team active: %s", (_label, section) => {
    expect(getActiveAgentTeam(section)).toBeNull();
  });
});

describe("findAgentTeam", () => {
  test("finds by id and tolerates missing inputs", () => {
    expect(findAgentTeam([crew], "team-crew")).toBe(crew);
    expect(findAgentTeam([crew], "nope")).toBeNull();
    expect(findAgentTeam(undefined, "team-crew")).toBeNull();
    expect(findAgentTeam([crew], null)).toBeNull();
  });
});

describe("isTeamMember", () => {
  test("checks membership by personality id", () => {
    expect(isTeamMember(crew, "p-atlas")).toBe(true);
    expect(isTeamMember(crew, "p-vera")).toBe(false);
    expect(isTeamMember(null, "p-atlas")).toBe(false);
    expect(isTeamMember({ memberIds: undefined }, "p-atlas")).toBe(false);
  });
});

describe("resolveTeamMembers", () => {
  test("resolves members in memberIds order, ignoring dangling ids", () => {
    expect(resolveTeamMembers(crew, roster)).toEqual([dash, atlas]);
  });

  test("dedupes repeated member ids", () => {
    expect(
      resolveTeamMembers({ memberIds: ["p-atlas", "p-atlas"] }, roster).map((p) => p.id),
    ).toEqual(["p-atlas"]);
  });

  test("returns empty for missing team or roster", () => {
    expect(resolveTeamMembers(null, roster)).toEqual([]);
    expect(resolveTeamMembers(crew, [])).toEqual([]);
    expect(resolveTeamMembers(crew, undefined)).toEqual([]);
  });
});

describe("pruneTeamMemberIds", () => {
  test("drops dangling ids and duplicates, preserving order", () => {
    expect(pruneTeamMemberIds(["p-dash", "p-deleted", "p-dash", "p-atlas"], roster)).toEqual([
      "p-dash",
      "p-atlas",
    ]);
  });

  test("returns empty for absent member ids", () => {
    expect(pruneTeamMemberIds(undefined, roster)).toEqual([]);
  });
});

describe("resolveExclusiveTeamMembers", () => {
  const panel: AgentTeam = { id: "team-panel", name: "Panel", memberIds: ["p-atlas", "p-vera"] };

  test("returns members no remaining team also claims", () => {
    // p-atlas is shared with the panel, p-deleted is dangling — only p-dash is
    // left with no team once the crew goes.
    expect(resolveExclusiveTeamMembers(crew, [panel], roster)).toEqual([dash]);
  });

  test("returns every resolvable member when no teams remain", () => {
    expect(resolveExclusiveTeamMembers(crew, [], roster)).toEqual([dash, atlas]);
    expect(resolveExclusiveTeamMembers(crew, undefined, roster)).toEqual([dash, atlas]);
  });

  test("returns empty when every member is shared", () => {
    expect(resolveExclusiveTeamMembers(crew, [crew], roster)).toEqual([]);
  });

  test("tolerates absent inputs", () => {
    expect(resolveExclusiveTeamMembers(null, [panel], roster)).toEqual([]);
    expect(resolveExclusiveTeamMembers(crew, [panel], undefined)).toEqual([]);
  });
});

describe("teamRoleUnion", () => {
  test("unions member roles in canonical order", () => {
    // Canonical PERSONALITY_ROLES order, not member order: chatter before
    // scheduler/writer, orchestrator last.
    expect(teamRoleUnion(crew, roster)).toEqual(["chatter", "scheduler", "writer", "orchestrator"]);
  });

  test("normalizes legacy role names from members", () => {
    const legacy = makePersonality({ id: "p-old", roles: ["worker"] });
    expect(teamRoleUnion({ memberIds: ["p-old"] }, [legacy])).toEqual(["coder"]);
  });
});

describe("getEffectiveTeamPrompt", () => {
  test("returns trimmed prompt content", () => {
    expect(getEffectiveTeamPrompt({ teamPrompt: "  Frame the crew.  " })).toBe("Frame the crew.");
  });

  test.each([
    ["absent team", null],
    ["no prompt", {}],
    ["empty prompt", { teamPrompt: "" }],
    ["whitespace prompt", { teamPrompt: "   \n  " }],
  ])("stacks nothing for %s", (_label, team) => {
    expect(getEffectiveTeamPrompt(team)).toBeNull();
  });
});
