/**
 * COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
 *
 * The stored agent template converged on Paseo's `AgentProfile`, so the wire
 * followed: eight request/response pairs gained profile-named twins (see the
 * block at the end of `protocol/src/personality-schemas.ts`). The daemon accepts
 * BOTH halves, which means exactly two translations and no duplicated handlers:
 *
 *  - inbound, a profile-named request is rewritten to its legacy twin before
 *    dispatch, so there is still one handler body per RPC;
 *  - outbound, the matching response is rewritten BACK, so a client that spoke
 *    the new names is answered in the new names.
 *
 * The outbound half is keyed on the request id rather than on a session-level
 * flag: a session-wide "this client speaks profile names" bit would answer the
 * wrong name for any client that mixes the two, and the whole point of accepting
 * both is that mixing is legal. `Session` only consults this when it is actually
 * tracking an aliased request, so a client speaking legacy names (which is every
 * shipping client until the floor rises) pays nothing per message.
 */

/** Profile-named request literal -> the legacy literal its handler is written against. */
const REQUEST_ALIASES: Readonly<Record<string, string>> = {
  "agent.profile.set.request": "agent.personality.set.request",
  "agent.profile.stats.request": "agentPersonalities.get_stats.request",
  "agent.profile.generate_prompt.request": "agentPersonalities.generate_profile.request",
  "agent.profile.generate_voice_cues.request": "visualizer.voiceCues.generate.request",
  "profile.memory.list.request": "personality.memory.list.request",
  "profile.memory.update.request": "personality.memory.update.request",
  "profile.memory.transfer.request": "personality.memory.transfer.request",
  "profile.memory.stats.request": "personality.memory.stats.request",
};

/** Legacy response literal -> the profile-named literal to answer an aliased request with. */
const RESPONSE_ALIASES: Readonly<Record<string, string>> = {
  "agent.personality.set.response": "agent.profile.set.response",
  "agentPersonalities.get_stats.response": "agent.profile.stats.response",
  "agentPersonalities.generate_profile.response": "agent.profile.generate_prompt.response",
  "visualizer.voiceCues.generate.response": "agent.profile.generate_voice_cues.response",
  "personality.memory.list.response": "profile.memory.list.response",
  "personality.memory.update.response": "profile.memory.update.response",
  "personality.memory.transfer.response": "profile.memory.transfer.response",
  "personality.memory.stats.response": "profile.memory.stats.response",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The request id an RPC message carries, which sits at the top level on requests
 * and inside `payload` on most responses. Returns null when there is none, which
 * is the normal case for streaming events.
 */
export function readRpcRequestId(msg: unknown): string | null {
  if (!isRecord(msg)) {
    return null;
  }
  if (typeof msg["requestId"] === "string") {
    return msg["requestId"];
  }
  const payload = msg["payload"];
  if (isRecord(payload) && typeof payload["requestId"] === "string") {
    return payload["requestId"];
  }
  return null;
}

/**
 * The legacy literal a profile-named request should be handled as, or null when
 * the message is not an alias. Callers rewrite `type` and record the request id.
 */
export function resolveAliasedRequestType(type: string): string | null {
  return REQUEST_ALIASES[type] ?? null;
}

/**
 * The profile-named literal to answer with, or null when this response type has
 * no twin (so the caller leaves it alone).
 */
export function resolveAliasedResponseType(type: string): string | null {
  return RESPONSE_ALIASES[type] ?? null;
}

/** Every response literal that has a profile-named twin. */
export function isAliasableResponseType(type: string): boolean {
  return type in RESPONSE_ALIASES;
}
