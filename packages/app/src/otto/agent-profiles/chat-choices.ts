import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import { hasProfileRole, teamProfiles, type Team } from "@getpaseo/protocol/otto/agent-teams";

export function chatterChoices(team: Team | undefined, available: readonly AgentProfile[]) {
  const chatters = available.filter((p) => hasProfileRole(p, "chatter"));
  const members = team && teamProfiles(team, chatters);
  if (members?.length) return { choices: members, fromTeam: true };
  return { choices: chatters, fromTeam: false };
}

export function defaultChatter(
  team: Team | undefined,
  available: readonly AgentProfile[],
  remembered?: string,
) {
  const { choices, fromTeam } = chatterChoices(team, available);
  if (fromTeam) return choices[0];
  return choices.find((p) => p.id === remembered) ?? choices[0];
}
