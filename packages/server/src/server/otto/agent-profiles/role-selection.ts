import { activeTeam, hasProfileRole, teamProfiles } from "@getpaseo/protocol/otto/agent-teams";
import type { ScheduleTarget } from "@getpaseo/protocol/schedule/types";
import { resolveHostProfile } from "./selection.js";

type Config = Extract<ScheduleTarget, { type: "new-agent" }>["config"];
type Catalog = NonNullable<Parameters<typeof resolveHostProfile>[3]>;
type Roster = Parameters<typeof resolveHostProfile>[0];
function uniqueName(profiles: NonNullable<Roster["agentProfiles"]>, name: string) {
  const exact = profiles.filter((p) => p.name === name.trim());
  const matches = exact.length
    ? exact
    : profiles.filter((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}
function availableModel(
  profile: NonNullable<Roster["agentProfiles"]>[number],
  entry: Awaited<ReturnType<Catalog>>,
) {
  if (!entry.enabled || entry.status !== "ready") return undefined;
  const models = entry.models ?? [];
  const model = profile.model
    ? models.find((m) => m.id === profile.model)
    : (models.find((m) => m.isDefault) ?? models[0]);
  return model?.id;
}
export function roleResolver(read: () => Roster, catalog: Catalog) {
  return async (role: "artificer" | "scheduler", id: string, cwd: string, legacyName = false) => {
    const roster = read(),
      profiles = roster.agentProfiles ?? [],
      team = activeTeam(roster.agentTeams);
    const dynamic = role === "scheduler" && id === "@team-scheduler";
    // COMPAT(scheduleProfileBinding): pre-0.8.13 Schedules stored display names; remove after 2027-02-22.
    const chosen =
      profiles.find((p) => p.id === id) ?? (legacyName ? uniqueName(profiles, id) : undefined);
    const pool =
      dynamic && team ? teamProfiles(team, profiles) : [chosen].filter((p) => p !== undefined);
    const candidates = pool.filter((p) => hasProfileRole(p, role));
    for (const profile of candidates) {
      const entry = await catalog(profile.provider, cwd);
      const model = availableModel(profile, entry);
      if (!model) continue;
      const selected = await resolveHostProfile(
        roster,
        profile.id,
        { provider: profile.provider, cwd, model },
        async () => entry,
      ).catch((error) => {
        if (!dynamic) throw error;
        return null;
      });
      if (!selected) continue;
      return { ...selected, model };
    }
    throw new Error(
      dynamic
        ? "The active Team has no available Scheduler."
        : "The selected Profile or its model is unavailable for this role.",
    );
  };
}
export type ResolveRole = ReturnType<typeof roleResolver>;
export async function scheduleProfile(config: Config, resolve?: ResolveRole) {
  const id = config.agentProfile || config.personality;
  if (!id) return { config };
  if (!resolve) throw new Error("This host cannot resolve Schedule Profiles.");
  const { profile, binding, model } = await resolve(
    "scheduler",
    id,
    config.cwd,
    !config.agentProfile,
  );
  return {
    config: {
      ...config,
      provider: profile.provider,
      model,
      modeId: profile.modeId,
      thinkingOptionId: profile.thinkingOptionId,
      featureValues: profile.featureValues,
    },
    binding,
  };
}
