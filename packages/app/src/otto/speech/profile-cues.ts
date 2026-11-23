import { ProfileCues, ProfileVoice, type CueMoment } from "@getpaseo/protocol/otto/agent-teams";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";

function metadata(serialized?: string) {
  if (!serialized) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}
export function spokenProfile(serialized?: string) {
  const data = metadata(serialized);
  const voice = ProfileVoice.safeParse("voice" in data ? data.voice : null);
  const cues = ProfileCues.safeParse("voiceCues" in data ? data.voiceCues : null);
  const choice = voice.success ? voice.data : null;
  const provider = choice?.provider;
  const selection =
    choice && (provider === "openai" || provider === "local")
      ? ({ provider, model: choice.model, voice: choice.name, speed: 1 } as const)
      : undefined;
  return { selection, profileVoice: !!selection, cues: cues.success ? cues.data : undefined };
}
export function voiceForChat(serverId: string, agentId: string) {
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  const { selection, profileVoice } = spokenProfile(agent?.labels["otto.profile"]);
  return { selection, profileVoice };
}
export function chooseLine(moment: CueMoment, profile: ReturnType<typeof spokenProfile>) {
  const lines = profile.cues?.[moment]?.filter((s) => s.trim());
  if (lines?.length) return lines[Math.floor(Math.random() * lines.length)];
  if (profile.cues) return undefined;
  return { join: "Starting!", thinking: "Thinking...", waiting: "Waiting...", done: "Complete!" }[
    moment
  ];
}
export function busyParents(serverId: string, agents: ReadonlyMap<string, Agent>) {
  const ids = new Set<string>();
  for (const agent of agents.values())
    if (agent.parentAgentId && agent.turn.phase === "open" && !agent.archivedAt)
      ids.add(agent.parentAgentId);
  for (const [key, child] of useProviderSubagentStore.getState().descriptors) {
    if (child.status === "running" && key.startsWith(serverId + "\0")) ids.add(child.parentAgentId);
  }
  return ids;
}
export function cueState(agent: Agent, children: boolean) {
  if (agent.turn.phase === "open") return "thinking";
  if (agent.status === "error" || agent.attentionReason === "error") return "error";
  if (children) return "waiting";
  return "done";
}
