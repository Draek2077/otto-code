import type { ManagedAgent } from "./agent/agent-manager.js";
import { toAgentPayload } from "./agent/agent-projections.js";
import type { AgentStreamEvent } from "./agent/agent-sdk-types.js";
import type { AgentSnapshotPayload, AgentStreamEventPayload } from "@otto-code/protocol/messages";
import { AgentStreamEventPayloadSchema as AgentStreamEventPayloadRuntimeSchema } from "@otto-code/protocol/messages";

export * from "@otto-code/protocol/messages";

// One stream event object fans out to every subscribed session, and each session
// used to re-run the same zod walk over the same payload: N clients times 10-50
// events/sec while streaming, worst on 100 KB+ tool_call_update snapshots. The
// event object is the identity, so memoizing on it collapses those N parses to 1.
// Callers only read the result (it gets serialized into an outbound payload), so
// sharing the parsed object across sessions is safe. WeakMap because entries
// should die with the event.
const streamEventPayloadCache = new WeakMap<AgentStreamEvent, AgentStreamEventPayload | null>();

function validateStreamEventPayload(payload: unknown): AgentStreamEventPayload | null {
  const parsed = AgentStreamEventPayloadRuntimeSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function serializeAgentSnapshot(
  agent: ManagedAgent,
  options?: { title?: string | null },
): AgentSnapshotPayload {
  return toAgentPayload(agent, options);
}

export function serializeAgentStreamEvent(event: AgentStreamEvent): AgentStreamEventPayload | null {
  const cached = streamEventPayloadCache.get(event);
  // has() as the fallback check, not a truthiness test: null is a real cached
  // result (a rejected event), and re-parsing it every time defeats the memo.
  if (cached !== undefined || streamEventPayloadCache.has(event)) {
    return cached ?? null;
  }
  const payload = validateAgentStreamEvent(event);
  streamEventPayloadCache.set(event, payload);
  return payload;
}

function validateAgentStreamEvent(event: AgentStreamEvent): AgentStreamEventPayload | null {
  if (event.type === "attention_required") {
    // Providers may emit attention_required without per-client notification context.
    // The websocket server emits attention_required with shouldNotify computed per client.
    // Normalize provider events so they satisfy the shared schema.
    return validateStreamEventPayload({
      type: "attention_required",
      provider: event.provider,
      reason: event.reason,
      timestamp: event.timestamp,
      shouldNotify: false,
    });
  }

  return validateStreamEventPayload(event);
}
