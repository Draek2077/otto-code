import type { AgentPersonality, AgentTeam } from "@otto-code/protocol/messages";
import { isPersonalityRole, personalityHasRole } from "@otto-code/protocol/agent-personalities";

// Resolve which member of the active team fills a role — the daemon-side mirror
// of the app's buildTeamRoleEntry. Returns the FIRST member (in team member
// order) carrying the role, or null when the team has no such member (the
// orchestration engine hard-fails and names the gap). Provider availability is
// NOT checked here — the spawn path validates that and throws with a precise
// reason; this only answers "does the team roster cover this role at all".
export function resolveTeamRoleMember(input: {
  team: Pick<AgentTeam, "memberIds"> | null | undefined;
  roster: readonly AgentPersonality[];
  role: string;
}): AgentPersonality | null {
  if (!input.team || !isPersonalityRole(input.role)) {
    return null;
  }
  const byId = new Map(input.roster.map((personality) => [personality.id, personality]));
  for (const memberId of input.team.memberIds ?? []) {
    const personality = byId.get(memberId);
    if (personality && personalityHasRole(personality, input.role)) {
      return personality;
    }
  }
  return null;
}
