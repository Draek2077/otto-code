import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy =
  | { kind: "archive-on-close" }
  | { kind: "layout-only" }
  | { kind: "close-only" };

export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "archivedAt" | "parentAgentId"> | null | undefined,
): CloseAgentTabPolicy {
  // An archived chat is already in History. Its open tab is only a view of
  // that record, so closing it must not offer to archive it again or mutate
  // its persisted tab label.
  if (agent?.archivedAt) {
    return { kind: "close-only" };
  }

  if (agent?.parentAgentId) {
    return { kind: "layout-only" };
  }

  return { kind: "archive-on-close" };
}
