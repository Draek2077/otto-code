import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentPersonality, AgentTeam, PersonalityRole } from "@otto-code/protocol/messages";
import { personalityHasRole } from "@otto-code/protocol/agent-personalities";
import { resolveTeamMembers } from "@otto-code/protocol/agent-teams";
import type { SelectorPersonality } from "@/components/combined-model-selector";
import {
  resolvePersonalityForForm,
  type PersonalityFormValues,
} from "@/provider-selection/personality-form";
import { ROLE_ICONS } from "@/provider-selection/role-icons";

// A synthetic "Team's <Role>" picker entry — a dynamic binding that resolves to
// the active team's member holding a given role, rather than a concrete
// personality. Shared by every surface that offers one (the schedule form's
// "Team's Scheduler", the artifact sheet's "Team's Artificer"): the surface owns
// how selection persists (a schedule stores a run-time sentinel; an artifact
// just applies the resolved values now), but the entry itself is built here.
export interface TeamRoleEntry {
  /** The picker row. Its `id` is the caller-provided local entry id. */
  selector: SelectorPersonality;
  /** Resolved form values of the CURRENT holder; null when nothing resolves. */
  values: PersonalityFormValues | null;
  /** The member resolved right now (for spinner snapshot, etc.); null if none. */
  member: AgentPersonality | null;
}

export interface BuildTeamRoleEntryInput {
  /** Local picker id for the synthetic row (never leaves the form). */
  entryId: string;
  /** Role the entry follows within the team. */
  role: PersonalityRole;
  /** Row display name, e.g. "Team's Scheduler". */
  label: string;
  /** Human role label used in the unavailable messages, e.g. "Scheduler". */
  roleLabel: string;
  team: AgentTeam;
  roster: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
}

/**
 * Resolve who the active team's holder of `role` is RIGHT NOW (first available
 * member carrying it, in member order) for the picker entry's display + form
 * auto-fill. Surfaces that re-resolve later (the daemon at each schedule run)
 * treat this as a preview; the entry's subtitle says the binding follows the
 * active team.
 */
export function buildTeamRoleEntry(input: BuildTeamRoleEntryInput): TeamRoleEntry {
  // Neutral role glyph — the row represents a role whose holder changes with the
  // team, so it never wears a concrete personality's colored provider icon.
  const roleIcon = ROLE_ICONS[input.role];
  const members = resolveTeamMembers(input.team, input.roster).filter((member) =>
    personalityHasRole(member, input.role),
  );
  if (members.length === 0) {
    return {
      selector: {
        id: input.entryId,
        name: input.label,
        provider: "",
        roleIcon,
        subtitle: `Team "${input.team.name}" has no ${input.roleLabel}`,
        available: false,
        unavailableReason: `No member of "${input.team.name}" has the ${input.roleLabel} role.`,
      },
      values: null,
      member: null,
    };
  }
  let firstReason: string | undefined;
  for (const member of members) {
    const resolution = resolvePersonalityForForm(member, input.entries);
    if (resolution.available) {
      // Show the current holder as "Currently: <Agent> · <Provider> · <Model>",
      // resolving the human-readable provider/model names from the live snapshot
      // (fall back to the raw ids when the snapshot has no match).
      const entry = input.entries.find((candidate) => candidate.provider === member.provider);
      const providerLabel = entry?.label ?? member.provider;
      const modelLabel =
        entry?.models?.find((candidate) => candidate.id === member.model)?.label ?? member.model;
      return {
        selector: {
          id: input.entryId,
          name: input.label,
          provider: member.provider,
          roleIcon,
          subtitle: `Currently: ${member.name} · ${providerLabel} · ${modelLabel}`,
          glowA: member.spinner?.glowA,
          glowB: member.spinner?.glowB,
          available: true,
        },
        values: resolution.values,
        member,
      };
    }
    firstReason ??= resolution.reason;
  }
  return {
    selector: {
      id: input.entryId,
      name: input.label,
      provider: members[0]?.provider ?? "",
      roleIcon,
      subtitle: `No ${input.roleLabel} available right now`,
      available: false,
      unavailableReason: firstReason,
    },
    values: null,
    member: null,
  };
}
