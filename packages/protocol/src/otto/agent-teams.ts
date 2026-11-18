import { z } from "zod";
import type { AgentProfile } from "../agent-profile.js";

export const profileRoles = [
  "chatter",
  "artificer",
  "scheduler",
  "researcher",
  "planner",
  "judger",
  "advisor",
  "coder",
  "designer",
  "writer",
  "orchestrator",
] as const;
export type ProfileRole = (typeof profileRoles)[number];
export const cueMoments = ["join", "thinking", "waiting", "done"] as const;
export type CueMoment = (typeof cueMoments)[number];
export const ProfileVoice = z
  .object({ provider: z.string(), model: z.string(), name: z.string() })
  .passthrough();
export const ProfileCues = z
  .object({
    join: z.array(z.string()).optional(),
    thinking: z.array(z.string()).optional(),
    waiting: z.array(z.string()).optional(),
    done: z.array(z.string()).optional(),
  })
  .passthrough();
export const Team = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    memberIds: z.array(z.string()).optional(),
    teamPrompt: z.string().optional(),
    avatar: z
      .object({ color: z.string().optional(), imageId: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const AgentTeams = z
  .object({
    teams: z.array(Team).optional(),
    activeTeamId: z.string().nullable().optional(),
    projectDefaults: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type AgentTeams = z.infer<typeof AgentTeams>;
export type Team = z.infer<typeof Team>;
export function activeTeam(config?: AgentTeams) {
  return config?.teams?.find((team) => team.id === config.activeTeamId);
}
export function teamProfiles(team: Team | undefined, profiles: readonly AgentProfile[]) {
  if (!team) return profiles;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return [...new Set(team.memberIds)].flatMap((id) => byId.get(id) ?? []);
}
export function hasProfileRole(profile: AgentProfile, role: ProfileRole) {
  return (
    Array.isArray(profile.roles) &&
    (profile.roles.includes(role) || (role === "coder" && profile.roles.includes("worker")))
  );
}
export function profilePrompt(profile: AgentProfile, team?: Team) {
  return [
    team?.memberIds?.includes(profile.id) ? team.teamPrompt?.trim() : "",
    typeof profile.personalityPrompt === "string" ? profile.personalityPrompt.trim() : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ProfileBinding = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  respectGlobal: z.boolean(),
  spinner: z.object({ glowA: z.string(), glowB: z.string() }).optional(),
  voice: ProfileVoice.optional(),
  voiceCues: ProfileCues.optional(),
});
export type ProfileBinding = z.infer<typeof ProfileBinding>;
export const profileIntentLabel = "otto.selectProfile";
export function bindProfile(
  config: { agentProfiles?: AgentProfile[]; agentTeams?: AgentTeams },
  id: string,
  provider: string,
) {
  const profile = config.agentProfiles?.find((p) => p.id === id);
  if (!profile || profile.provider !== provider)
    throw new Error("This Profile is unavailable for this chat provider.");
  const binding = ProfileBinding.parse({
    id: profile.id,
    name: profile.name,
    prompt: profilePrompt(profile, activeTeam(config.agentTeams)),
    respectGlobal: profile.respectGlobalAppendPrompt !== false,
    spinner: profile.spinner,
    voice: profile.voice,
    voiceCues: profile.voiceCues,
  });
  return { profile, binding };
}
export function presentationLabel(binding: ProfileBinding) {
  return JSON.stringify({
    id: binding.id,
    name: binding.name,
    spinner: binding.spinner,
    voice: binding.voice,
    voiceCues: binding.voiceCues,
  });
}
