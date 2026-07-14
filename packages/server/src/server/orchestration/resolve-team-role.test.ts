import { describe, expect, test } from "vitest";
import type { AgentPersonality } from "@otto-code/protocol/messages";

import { resolveTeamRoleMember } from "./resolve-team-role.js";

function personality(id: string, roles: string[]): AgentPersonality {
  return { id, name: id, provider: "claude", model: "claude-sonnet-5", roles };
}

const roster: AgentPersonality[] = [
  personality("atlas", ["orchestrator", "chatter"]),
  personality("sage", ["advisor", "researcher", "planner"]),
  personality("vera", ["judger"]),
];

describe("resolveTeamRoleMember", () => {
  test("returns the first team member carrying the role, in member order", () => {
    const team = { memberIds: ["atlas", "sage", "vera"] };
    expect(resolveTeamRoleMember({ team, roster, role: "researcher" })?.id).toBe("sage");
    expect(resolveTeamRoleMember({ team, roster, role: "judger" })?.id).toBe("vera");
    expect(resolveTeamRoleMember({ team, roster, role: "orchestrator" })?.id).toBe("atlas");
  });

  test("returns null when no member fills the role (the gap the engine reports)", () => {
    const team = { memberIds: ["atlas", "vera"] };
    expect(resolveTeamRoleMember({ team, roster, role: "designer" })).toBeNull();
  });

  test("returns null for an unknown role or absent team", () => {
    expect(
      resolveTeamRoleMember({ team: { memberIds: ["atlas"] }, roster, role: "wizard" }),
    ).toBeNull();
    expect(resolveTeamRoleMember({ team: null, roster, role: "judger" })).toBeNull();
  });

  test("ignores member ids that aren't in the roster", () => {
    const team = { memberIds: ["ghost", "sage"] };
    expect(resolveTeamRoleMember({ team, roster, role: "planner" })?.id).toBe("sage");
  });
});
