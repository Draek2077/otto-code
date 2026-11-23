import type { PersistedConfig } from "../../../../server/src/server/persisted-config";

// These hosts exercise an explicitly selected provider with no Team choosing a default model.
export const unassignedRoster = {
  agentProfiles: [],
  agentTeams: { activeTeamId: null, teams: [] },
} satisfies NonNullable<PersistedConfig["daemon"]>;
