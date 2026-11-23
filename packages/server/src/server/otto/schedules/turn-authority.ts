import type { AgentRunOptions } from "../../agent/agent-sdk-types.js";
import { ScheduleError } from "./files.js";

export interface ScheduleTurnReceipt {
  readonly agentId: string;
  readonly turnId: string;
}
interface Grant {
  agentId: string;
  active(): boolean;
  accepted(receipt: ScheduleTurnReceipt): void;
  admitted: boolean;
}
const grants = new WeakMap<AgentRunOptions, Grant>();
const sessions = new WeakMap<ScheduleTurnReceipt, object>();
const pending = new WeakMap<object, Map<string, Set<object>>>();

/** Private one-use capability, never serialized as provider config, labels or wire data. */
export function scheduleTurnOptions(
  agentId: string,
  active: () => boolean,
  accepted: Grant["accepted"],
): AgentRunOptions {
  const options: AgentRunOptions = {};
  grants.set(options, { agentId, active, accepted, admitted: false });
  return options;
}
export function assertScheduleTurn(
  options: AgentRunOptions | undefined,
  agentId: string,
  stage: "admit" | "execute",
) {
  const grant = options && grants.get(options);
  if (!grant) return;
  if (grant.agentId !== agentId || !grant.active() || grant.admitted === (stage === "admit"))
    throw new Error("This Schedule turn was revoked or already admitted.");
  if (stage === "admit") grant.admitted = true;
}
export function assertScheduleTurnIdle(options: AgentRunOptions | undefined, busy: boolean) {
  if (busy && options && grants.has(options))
    throw new ScheduleError(
      "busy",
      "The scheduled chat already has an active turn. Waiting until the next scheduled time.",
    );
}
export function recordScheduleTurn(
  options: AgentRunOptions | undefined,
  agentId: string,
  turnId: string,
  session: object,
) {
  const grant = options && grants.get(options);
  if (!grant || grant.agentId !== agentId) return;
  const receipt = { agentId, turnId };
  sessions.set(receipt, session);
  grant.accepted(receipt);
}
export function ownsScheduleTurn(
  receipt: ScheduleTurnReceipt,
  agentId: string,
  turnId: string | null,
  session: object,
) {
  return (
    receipt.agentId === agentId && receipt.turnId === turnId && sessions.get(receipt) === session
  );
}
export function assertScheduleTurnAvailable(owner: object, agentId: string) {
  if (pending.get(owner)?.get(agentId)?.size)
    throw new Error(
      "A Schedule provider operation is still settling for this chat. Wait before starting or changing another turn.",
    );
}
/** The lease ends when the actual provider promise settles, not when a caller's
 * timeout expires. A late interrupt must never land on a subsequent manual turn. */
export async function retainScheduleProviderOperation<T>(
  owner: object,
  agentId: string,
  operation: () => Promise<T>,
) {
  const agents = pending.get(owner) ?? new Map<string, Set<object>>();
  pending.set(owner, agents);
  const leases = agents.get(agentId) ?? new Set<object>();
  agents.set(agentId, leases);
  const lease = {};
  leases.add(lease);
  try {
    return await operation();
  } finally {
    leases.delete(lease);
    if (!leases.size) agents.delete(agentId);
    if (!agents.size) pending.delete(owner);
  }
}
export function startScheduleProviderTurn<T>(
  owner: object,
  agentId: string,
  options: AgentRunOptions | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return options && grants.has(options)
    ? retainScheduleProviderOperation(owner, agentId, operation)
    : operation();
}
