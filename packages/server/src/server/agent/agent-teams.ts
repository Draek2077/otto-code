import {
  getActiveAgentTeam,
  getEffectiveTeamPrompt,
  isTeamMember,
  resolveTeamMembers,
  type AgentTeamsConfigView,
} from "@otto-code/protocol/agent-teams";
import {
  composeRoleFocusDirective,
  personalityHasRole,
} from "@otto-code/protocol/agent-personalities";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import { resolvePersonality, type ResolvedPersonalitySnapshot } from "./agent-personalities.js";
import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";

/**
 * The active team resolved at spawn and frozen onto the agent as
 * `AgentSessionConfig.teamSnapshot` — the team-layer sibling of
 * `personalitySnapshot`, with the same lifecycle: switching the active team
 * never mutates a running or observed agent; the born team is part of the
 * agent's identity, like its cwd. Only the fields spawn semantics need are
 * frozen (id/name for provenance, prompt for recomposition on a live
 * personality switch, color for display).
 */
export interface ResolvedTeamSnapshot {
  teamId: string;
  name: string;
  avatarColor?: string;
  /** The effective (trimmed, non-empty) team prompt; absent = purely organizational team. */
  teamPrompt?: string;
}

/**
 * The one team rule, applied at every spawn path: if the spawning personality
 * is a member of the active team at spawn time, the team layer rides onto the
 * agent. Raw spawns (no personality) and non-member personality spawns get no
 * team layer — and no active team, a dangling active id, or an empty roster
 * all read as "no team", never an error.
 */
export function resolveTeamSnapshotForPersonality(
  agentTeams: AgentTeamsConfigView | undefined,
  personalityId: string | undefined,
): ResolvedTeamSnapshot | null {
  if (!personalityId) {
    return null;
  }
  const team = getActiveAgentTeam(agentTeams);
  if (!team || !isTeamMember(team, personalityId)) {
    return null;
  }
  const snapshot: ResolvedTeamSnapshot = { teamId: team.id, name: team.name };
  const avatarColor = team.avatar?.color;
  if (avatarColor) {
    snapshot.avatarColor = avatarColor;
  }
  const teamPrompt = getEffectiveTeamPrompt(team);
  if (teamPrompt) {
    snapshot.teamPrompt = teamPrompt;
  }
  return snapshot;
}

/**
 * Resolve the dynamic "Team's Scheduler" schedule binding: the active team's
 * first AVAILABLE member carrying the Scheduler role, in memberIds order.
 * Every failure is a loud, named error — the same hard-fail semantics as a
 * bound personality being out of commission (never a silent fallback).
 */
export function resolveTeamSchedulerSnapshot(params: {
  agentTeams: AgentTeamsConfigView | undefined;
  roster: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
}): ResolvedPersonalitySnapshot {
  const team = getActiveAgentTeam(params.agentTeams);
  if (!team) {
    throw new Error(
      "Schedule is bound to the active team's Scheduler, but no team is active on this host.",
    );
  }
  const schedulers = resolveTeamMembers(team, params.roster).filter((member) =>
    personalityHasRole(member, "scheduler"),
  );
  if (schedulers.length === 0) {
    throw new Error(
      `Schedule is bound to the active team's Scheduler, but team "${team.name}" has no member with the Scheduler role.`,
    );
  }
  let firstReason: string | null = null;
  for (const member of schedulers) {
    const resolution = resolvePersonality(member, params.entries);
    if (resolution.status === "available") {
      return resolution.snapshot;
    }
    firstReason ??= `${member.name}: ${resolution.reason}`;
  }
  throw new Error(
    `Schedule is bound to the active team's Scheduler, but no Scheduler in team "${team.name}" is available (${firstReason ?? "unknown reason"}).`,
  );
}

function composeTeamPromptBase(
  teamPrompt: string | undefined,
  personalityPrompt: string | undefined,
): string | undefined {
  if (!teamPrompt) {
    return personalityPrompt;
  }
  if (personalityPrompt === undefined || personalityPrompt.trim().length === 0) {
    return teamPrompt;
  }
  return `${teamPrompt}\n\n${personalityPrompt}`;
}

/**
 * Compose the personality-owned system prompt, applied at EVERY spawn path
 * (create_agent, the app composer, schedule runs, live personality switch) so a
 * personality operates with its full context brief no matter how the chat
 * started. The stack, top to bottom: team prompt (frames the collective) →
 * personality prompt (specializes within it) → role-focus directive (tells a
 * coordinator "orchestration is yours" or a focused worker "stay on task").
 *
 * `roles` are the resolved snapshot's roles; omit them (or pass none) and no
 * directive is appended — with no team layer and no roles the personality prompt
 * passes through verbatim, byte-identical to pre-teams behavior. A team prompt
 * or directive with no personality prompt stands alone. Callers still apply the
 * ownership rule: a caller-authored systemPrompt wins and nothing composes.
 */
export function composeTeamAndPersonalityPrompt(
  teamSnapshot: Pick<ResolvedTeamSnapshot, "teamPrompt"> | null | undefined,
  personalityPrompt: string | undefined,
  roles?: readonly string[],
): string | undefined {
  const base = composeTeamPromptBase(teamSnapshot?.teamPrompt, personalityPrompt);
  const directive = composeRoleFocusDirective(roles);
  if (!directive) {
    return base;
  }
  return base ? `${base}\n\n${directive}` : directive;
}
