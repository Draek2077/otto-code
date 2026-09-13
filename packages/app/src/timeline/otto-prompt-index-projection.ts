import type { TimelineResponsePayload } from "./viewed-timeline-sync";
import type { ProcessTimelineResponseOutput } from "./session-stream-reducers";
import { useSessionStore } from "@/stores/session-store";

/** Project Otto's complete prompt outline only after canonical timeline acceptance. */
export function projectOttoPromptIndex(
  serverId: string,
  payload: TimelineResponsePayload,
  result: ProcessTimelineResponseOutput,
): void {
  const incoming = payload.promptIndex;
  if (!incoming || result.error || result.commit !== "apply") return;
  const acceptedEpoch = result.cursor?.epoch ?? payload.epoch;
  if (incoming.epoch !== payload.epoch || incoming.epoch !== acceptedEpoch) return;
  useSessionStore.getState().setAgentTimelinePromptIndexes(serverId, (current) => {
    const previous = current.get(payload.agentId);
    // InMemoryAgentTimelineStore.append advances seq without removing prompts;
    // agent history replacement initializes a new UUID epoch. An older complete
    // index in the same epoch must not replace the newer prompt frontier.
    if (
      previous?.epoch === incoming.epoch &&
      (previous.prompts.at(-1)?.seq ?? -1) > (incoming.prompts.at(-1)?.seq ?? -1)
    )
      return current;
    const next = new Map(current);
    next.set(payload.agentId, incoming);
    return next;
  });
}
