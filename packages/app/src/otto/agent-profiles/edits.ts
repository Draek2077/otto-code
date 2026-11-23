import { AgentProfileSchema, type AgentProfile } from "@getpaseo/protocol/messages";

const EDITOR_FIELDS = new Set(Object.keys(AgentProfileSchema.shape));

/** Keep preserved Otto extensions while allowing cleared basic editor fields to disappear. */
export function mergeEditedProfile(
  previous: AgentProfile,
  value: { name: string; provider: string; [key: string]: unknown },
): AgentProfile {
  const retained = Object.fromEntries(
    Object.entries(previous).filter(([key]) => !EDITOR_FIELDS.has(key)),
  );
  return { ...retained, ...value, id: previous.id };
}
