import {
  activeTeam,
  hasProfileRole,
  bindProfile,
  profileRoles,
  teamProfiles,
} from "@getpaseo/protocol/otto/agent-teams";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { EffortResolutionError, resolveEffortOption } from "@getpaseo/protocol/otto/profile-effort";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import type { WorkflowLaunch, WorkflowTeamSnapshot } from "@getpaseo/plugin/otto/workflows";
import { WorkflowError } from "./files.js";

function seatModel(provider: ProviderSnapshotEntry | undefined, modelId?: string) {
  return modelId
    ? provider?.models?.find((m) => m.id === modelId)
    : (provider?.models?.find((m) => m.isDefault) ?? provider?.models?.[0]);
}

function eligibleSeats(
  config: Pick<MutableDaemonConfig, "agentTeams" | "agentProfiles">,
  profile: NonNullable<MutableDaemonConfig["agentProfiles"]>[number],
  catalog?: ProviderSnapshotEntry[],
) {
  const provider = catalog?.find(
    (entry) => entry.provider === profile.provider && entry.enabled && entry.status === "ready",
  );
  const model = seatModel(provider, profile.model);
  if (
    catalog &&
    (!model ||
      (profile.modeId &&
        provider?.modes &&
        !provider.modes.some((mode) => mode.id === profile.modeId)))
  )
    return [];
  const requested =
    profile.thinkingOptionId ||
    (typeof profile.effortLevel === "string" ? profile.effortLevel : undefined);
  let thinkingOptionId;
  try {
    thinkingOptionId =
      requested && model
        ? resolveEffortOption({ requested, thinkingOptions: model.thinkingOptions ?? [] }).optionId
        : profile.thinkingOptionId;
  } catch (error) {
    if (error instanceof EffortResolutionError) return [];
    throw error;
  }
  const binding = bindProfile(config, profile.id, profile.provider).binding;
  return [
    {
      profile,
      binding,
      seat: {
        provider: profile.provider,
        model: model?.id ?? profile.model,
        modeId: profile.modeId,
        thinkingOptionId,
      },
    },
  ];
}

export function captureWorkflowTeam(
  config: Pick<MutableDaemonConfig, "agentTeams" | "agentProfiles">,
  catalog?: ProviderSnapshotEntry[],
): WorkflowTeamSnapshot | undefined {
  const team = activeTeam(config.agentTeams);
  if (!team) return undefined;
  const members = teamProfiles(team, config.agentProfiles ?? []);
  const seats = members.flatMap((profile) => eligibleSeats(config, profile, catalog));
  const roles = profileRoles.flatMap((role) => {
    const match = seats.find((m) => hasProfileRole(m.profile, role));
    if (!match) return [];
    return [
      {
        role,
        profileId: match.profile.id,
        name: match.profile.name,
        prompt: match.binding.prompt,
        binding: match.binding,
        seat: match.seat,
      },
    ];
  });
  return { id: team.id, name: team.name, roles };
}
export function boundRole(launch: WorkflowLaunch, role?: string | null) {
  if (!launch.teamSnapshot || !role) return undefined;
  const member = launch.teamSnapshot.roles.find(
    (entry) => entry.role === (role === "worker" ? "coder" : role),
  );
  if (!member)
    throw new WorkflowError(
      "unsupported",
      `Team ${launch.teamSnapshot.name} has no Profile for the ${role} role.`,
    );
  return member;
}
