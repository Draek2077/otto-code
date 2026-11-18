import type { AgentTeams, Team } from "@getpaseo/protocol/otto/agent-teams";
export function cleanTeamReferences(config: AgentTeams | undefined, roster: Team[] | undefined) {
  if (!config || !roster) return;
  const ids = new Set(roster.map((team) => team.id));
  if (config.activeTeamId && !ids.has(config.activeTeamId)) config.activeTeamId = null;
  if (config.projectDefaults)
    config.projectDefaults = Object.fromEntries(
      Object.entries(config.projectDefaults).filter(([, id]) => ids.has(id)),
    );
}
