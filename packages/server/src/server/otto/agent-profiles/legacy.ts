import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { AgentProfileSchema } from "@getpaseo/protocol/agent-profile";
import { AgentTeams } from "@getpaseo/protocol/otto/agent-teams";

const legacy = z.object({
  daemon: z.object({ agentProfilesImportedPersonalities: z.boolean().optional() }).optional(),
  agents: z
    .object({
      agentPersonalities: z.object({ personalities: z.array(AgentProfileSchema) }).optional(),
      agentTeams: z.unknown().optional(),
    })
    .optional(),
});
const daemonShape = z
  .object({
    agentProfiles: z.array(AgentProfileSchema).optional(),
    agentTeams: AgentTeams.optional(),
    ottoProfilesImported: z.boolean().optional(),
  })
  .passthrough();

// COMPAT(otto09Roster): added in 0.10.0, review after 2027-05-18. Both a freshly
// split home and a home already used by 0.10 retain the original records.
export function recoverLegacyRoster(
  config: Record<string, unknown>,
  fresh: unknown,
  sidecar: string,
): boolean {
  const current = daemonShape.safeParse(config.daemon ?? {});
  if (!current.success || current.data.ottoProfilesImported) return false;
  const preserved = existsSync(sidecar)
    ? (JSON.parse(readFileSync(sidecar, "utf8")) as unknown)
    : undefined;
  const legacyFiles = [preserved, fresh, config]
    .map((data) => legacy.safeParse(data))
    .flatMap((result) => (result.success ? [result.data] : []));
  const sources = legacyFiles.flatMap((file) => (file.agents ? [file.agents] : []));
  // 0.9 already imported these ids on some hosts. Its tombstone can still contain
  // deleted Profiles and cleared fields; only the canonical roster is current there.
  const imported = legacyFiles.some(
    (file) => file.daemon?.agentProfilesImportedPersonalities === true,
  );
  const profiles = imported
    ? undefined
    : sources.find((s) => s.agentPersonalities)?.agentPersonalities?.personalities;
  const teams = AgentTeams.safeParse(sources.find((s) => s.agentTeams !== undefined)?.agentTeams);
  if (!profiles && !teams.success) return false;
  const daemon = current.data;
  const existing = new Map(daemon.agentProfiles?.map((p) => [p.id, p]));
  for (const profile of profiles ?? [])
    existing.set(profile.id, { ...profile, ...existing.get(profile.id) });
  config.daemon = {
    ...daemon,
    ...(profiles ? { agentProfiles: [...existing.values()] } : {}),
    ...(teams.success && !daemon.agentTeams ? { agentTeams: teams.data } : {}),
    ottoProfilesImported: true,
  };
  return true;
}
