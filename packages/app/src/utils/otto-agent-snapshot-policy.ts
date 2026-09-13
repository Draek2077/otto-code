import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";

export function resolveOttoProfileIdentity(snapshot: AgentSnapshotPayload) {
  // COMPAT(agentProfileFields): added in v0.8.13; remove after 2027-02-22.
  return {
    personalitySpinner: snapshot.agentProfileSpinner ?? snapshot.personalitySpinner ?? null,
    personalityName: snapshot.agentProfileName ?? snapshot.personalityName ?? null,
    personalityId: snapshot.agentProfileId ?? snapshot.personalityId ?? null,
  };
}
