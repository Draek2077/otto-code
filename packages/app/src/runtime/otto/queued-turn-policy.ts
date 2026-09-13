import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import type { TurnLiveness } from "@/timeline/turn-liveness";

/** Local queue delivery policy. Liveness closing does not imply a successful turn. */
export class OttoQueuedTurnPolicy {
  private readonly held = new Map<string, Map<string, string | null>>();

  holdForCancellation(serverId: string, agentId: string, turn?: TurnLiveness): void {
    // Stop holds automatic delivery even if its RPC rejects or its terminal stream
    // is not viewed. Settlement cannot release it; a new turn or explicit send can.
    const holds = this.held.get(serverId) ?? new Map<string, string | null>();
    holds.set(agentId, turn?.phase === "open" ? turn.turnId : null);
    this.held.set(serverId, holds);
  }

  observe(
    serverId: string,
    agentId: string,
    event: AgentStreamEventPayload,
    turn?: TurnLiveness,
  ): void {
    const holds = this.held.get(serverId);
    if (event.type === "turn_started") {
      // A replayed start of the canceled/failed identified turn cannot release its hold.
      if (event.turnId && holds?.get(agentId) === event.turnId) return;
      holds?.delete(agentId);
      if (holds?.size === 0) this.held.delete(serverId);
      return;
    }
    if (event.type !== "turn_failed" && event.type !== "turn_canceled") return;
    if (turn?.phase === "open" && turn.turnId && event.turnId && turn.turnId !== event.turnId)
      return;
    const next = holds ?? new Map<string, string | null>();
    next.set(agentId, event.turnId ?? null);
    this.held.set(serverId, next);
  }

  allowsAutomaticDrain(
    serverId: string,
    agentId: string,
    status: string | undefined,
    daemonOwnsQueue: boolean,
  ): boolean {
    return (
      !daemonOwnsQueue &&
      status !== "error" &&
      status !== "closed" &&
      !this.held.get(serverId)?.has(agentId)
    );
  }

  removeHost(serverId: string): void {
    this.held.delete(serverId);
  }
}
