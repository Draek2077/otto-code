import { useCallback } from "react";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";
import { supportsAgentProfiles } from "./capabilities";

export interface UseAgentProfilesResult {
  /** `null` until the daemon config has arrived. */
  profiles: AgentProfile[] | null;
  teams?: import("@getpaseo/protocol/otto/agent-teams").AgentTeams; // OTTO(agent-teams)
  /** False on daemons that predate agent profiles, or while disconnected. */
  isSupported: boolean;
  /** Writes the whole list; there is no per-profile RPC. */
  saveProfiles: (next: AgentProfile[]) => Promise<void>;
}

export function useAgentProfiles(serverId: string | null): UseAgentProfilesResult {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore((state) => {
    return supportsAgentProfiles(state.sessions[serverId ?? ""]?.serverInfo?.features);
  });

  const saveProfiles = useCallback(
    async (next: AgentProfile[]) => {
      if (
        !(await patchConfig({
          agentProfiles: next,
          expectedProfileRoster: config?.agentProfiles ?? [],
        }))
      )
        throw new Error("The host disconnected before Profiles were saved."); // OTTO(agent-teams)
    },
    [config?.agentProfiles, patchConfig],
  );

  return {
    teams: config?.agentTeams, // OTTO(agent-teams)
    profiles: config ? (config.agentProfiles ?? []) : null,
    isSupported,
    saveProfiles,
  };
}
