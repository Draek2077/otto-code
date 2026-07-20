import { normalizePersonalityRoles } from "./agent-personalities.js";
import type { AgentPersonality, AgentTeam, PersonalityRole } from "./messages.js";

// Pure, dependency-free team helpers shared by the daemon (spawn-time active
// team resolution, list_personalities scoping) and the app (team cards,
// pickers, the Active Team switcher). Availability is deliberately NOT here —
// a team is never "out of commission"; its members are individually available
// or not, judged by checkPersonalityAvailability per member.

/**
 * The dynamic "Team's Scheduler" schedule binding. Stored in the schedule's
 * `personality` field in place of a personality name; resolved at RUN time to
 * the active team's first available member carrying the Scheduler role
 * (member order). Deliberately contains "@" — personality names are sanitized
 * to [A-Za-z0-9_-] at the authoring surface, so the sentinel can never collide
 * with a real name. No active team, or no available Scheduler member, is a
 * hard run failure with a named error (same loudness as a bound personality
 * being out of commission).
 */
export const TEAM_SCHEDULER_PERSONALITY_SENTINEL = "@team-scheduler";

// Structural view of the `agentTeams` config section so both the app's parsed
// config shape and the daemon's MutableDaemonConfig can feed these helpers
// without importing each other's types.
export interface AgentTeamsConfigView {
  teams?: readonly AgentTeam[] | undefined;
  activeTeamId?: string | null | undefined;
}

export function findAgentTeam(
  teams: readonly AgentTeam[] | undefined,
  teamId: string | null | undefined,
): AgentTeam | null {
  if (!teamId) {
    return null;
  }
  return teams?.find((team) => team.id === teamId) ?? null;
}

/**
 * Resolve the host's active team. A dangling `activeTeamId` (team deleted, or
 * a patch raced a delete) reads as "no team active" — teamlessness is a valid
 * state and must never error. The daemon additionally heals a dangling id back
 * to null on the next config patch; this helper is the read-side tolerance.
 */
export function getActiveAgentTeam(section: AgentTeamsConfigView | undefined): AgentTeam | null {
  return findAgentTeam(section?.teams, section?.activeTeamId);
}

export function isTeamMember(
  team: Pick<AgentTeam, "memberIds"> | null | undefined,
  personalityId: string | null | undefined,
): boolean {
  if (!team || !personalityId) {
    return false;
  }
  return (team.memberIds ?? []).includes(personalityId);
}

/**
 * Resolve a team's members against the personality roster, in `memberIds`
 * order, deduped. A member id pointing at a deleted personality is tolerated
 * and ignored (it is pruned opportunistically on the next save of the team,
 * never eagerly cascaded on delete).
 */
export function resolveTeamMembers(
  team: Pick<AgentTeam, "memberIds"> | null | undefined,
  personalities: readonly AgentPersonality[] | undefined,
): AgentPersonality[] {
  if (!team || !personalities || personalities.length === 0) {
    return [];
  }
  const byId = new Map(personalities.map((personality) => [personality.id, personality]));
  const seen = new Set<string>();
  const members: AgentPersonality[] = [];
  for (const memberId of team.memberIds ?? []) {
    if (seen.has(memberId)) {
      continue;
    }
    seen.add(memberId);
    const personality = byId.get(memberId);
    if (personality) {
      members.push(personality);
    }
  }
  return members;
}

/**
 * The save-time prune: drop member ids that no longer resolve to a personality
 * (and dedupe), preserving order. Editors call this when persisting a team so
 * dangling ids don't accumulate; readers never require it.
 */
export function pruneTeamMemberIds(
  memberIds: readonly string[] | undefined,
  personalities: readonly AgentPersonality[] | undefined,
): string[] {
  if (!memberIds || memberIds.length === 0) {
    return [];
  }
  const known = new Set((personalities ?? []).map((personality) => personality.id));
  const seen = new Set<string>();
  return memberIds.filter((memberId) => {
    if (seen.has(memberId) || !known.has(memberId)) {
      return false;
    }
    seen.add(memberId);
    return true;
  });
}

/**
 * The members a team owns exclusively: personalities on `team` that no team in
 * `otherTeams` also lists. These are the ones deleting `team` would leave on no
 * team at all, so the delete confirm can offer to clean them up. Dangling member
 * ids resolve to nothing and drop out, same as everywhere else.
 *
 * Pass the teams that will REMAIN after the delete — the caller owns the filter,
 * so this stays a pure set operation with no notion of "the team being deleted".
 */
export function resolveExclusiveTeamMembers(
  team: Pick<AgentTeam, "memberIds"> | null | undefined,
  otherTeams: readonly Pick<AgentTeam, "memberIds">[] | undefined,
  personalities: readonly AgentPersonality[] | undefined,
): AgentPersonality[] {
  const claimed = new Set<string>();
  for (const other of otherTeams ?? []) {
    for (const memberId of other.memberIds ?? []) {
      claimed.add(memberId);
    }
  }
  return resolveTeamMembers(team, personalities).filter(
    (personality) => !claimed.has(personality.id),
  );
}

/**
 * The union of all members' roles, normalized and returned in canonical
 * `PERSONALITY_ROLES` order — the team card's role-pill strip.
 */
export function teamRoleUnion(
  team: Pick<AgentTeam, "memberIds"> | null | undefined,
  personalities: readonly AgentPersonality[] | undefined,
): PersonalityRole[] {
  const roles = resolveTeamMembers(team, personalities).flatMap(
    (personality) => personality.roles ?? [],
  );
  return normalizePersonalityRoles(roles);
}

/**
 * A team prompt only stacks when it has content; a team with an empty or
 * whitespace prompt is purely organizational (picker scoping, no prompt layer).
 */
export function getEffectiveTeamPrompt(
  team: Pick<AgentTeam, "teamPrompt"> | null | undefined,
): string | null {
  const prompt = team?.teamPrompt?.trim();
  return prompt && prompt.length > 0 ? prompt : null;
}
