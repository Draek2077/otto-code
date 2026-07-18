import type { ContextBreakdown } from '@/lib/agent-types'
import type { ConversationMessage } from './types'
import { appendConversation, asString } from './types'
import type { MutableEventState } from './process-event'

export function handleMessage(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
): void {
  const agentName = asString(payload.agent)
  const content = asString(payload.content)
  const role = typeof payload.role === 'string' ? payload.role : undefined

  // Map role to conversation message type
  const msgType: ConversationMessage['type'] =
    role === 'user' ? 'user' :
    role === 'thinking' ? 'thinking' :
    'assistant'

  // OTTO PATCH (OTTO-PATCHES.md): upstream renamed the main agent to the first
  // user message here ("more recognizable than 'orchestrator'") — a demo nicety
  // for generically-named spawns. Otto's host is authoritative for node names
  // (agent_spawn `name` is the chat title; agent_rename tracks title changes),
  // so that block CLOBBERED the title with the first prompt on every history
  // replay (refresh backfill, session-switch cold start) — and no rename ever
  // healed it, because the host's rename is edge-triggered on title CHANGE.
  // Removed outright; `task` was written only here for main agents and is not
  // read by any Otto-embedded surface.

  // Update agent state (but NOT the floating canvas bubbles).
  //
  // OTTO PATCH (OTTO-PATCHES.md): the on-canvas message bubbles are suppressed.
  // The visualizer is a companion to the real chat the user already has open,
  // so the floating per-message popups duplicated that chat and obscured the
  // orchestration the graph exists to show. Only the visual popup is dropped —
  // the message still flows through this handler into `state.conversations`
  // below (`appendConversation`), so the message REMAINS part of the record
  // (per-node history / timeline) and a node's account of what it did is
  // unchanged. The node's lifecycle state (→ 'thinking' on real message
  // activity) is preserved too; that's activity, not a popup. `messageBubbles`
  // is fed nowhere else, so it simply stays empty (draw-bubbles/hit-detection/
  // camera framing all short-circuit on the empty array). To re-enable, restore
  // the removed `updates.messageBubbles` push.
  const msgAgent = state.agents.get(agentName)
  if (msgAgent) {
    if (msgAgent.state !== 'complete' && msgAgent.state !== 'tool_calling') {
      if (role === 'user' || role === 'thinking' || role === 'assistant') {
        state.agents.set(agentName, { ...msgAgent, state: 'thinking' })
      }
    }
  }

  appendConversation(state.conversations, agentName, { type: msgType, content, timestamp: currentTime })
}

export function handleContextUpdate(
  payload: Record<string, unknown>,
  state: MutableEventState,
): void {
  const agentName = asString(payload.agent)
  // OTTO PATCH (OTTO-PATCHES.md): `tokens` is optional now — an update may
  // carry only `cumulativeTokens` (honest lifetime total for token/cost
  // sums) without clobbering the context-occupancy reading to 0.
  const tokens = typeof payload.tokens === 'number' ? payload.tokens : undefined
  const cumulativeTokens = typeof payload.cumulativeTokens === 'number'
    ? payload.cumulativeTokens
    : undefined
  const raw = payload.breakdown
  const breakdown = (raw && typeof raw === 'object' && 'systemPrompt' in raw) ? raw as ContextBreakdown : undefined
  // Optional override from runtimes that report an authoritative context window
  // (e.g. Codex's event_msg.token_count.info.model_context_window).
  const tokensMaxOverride = typeof payload.tokensMax === 'number' && payload.tokensMax > 0
    ? payload.tokensMax
    : undefined
  const agent = state.agents.get(agentName)
  if (agent) {
    // OTTO PATCH (OTTO-PATCHES.md): a context_update is pure token accounting —
    // it must NOT drive the lifecycle state. Upstream forced 'thinking' here,
    // assuming context updates only arrive mid-reasoning. Otto's host pushes a
    // context_update from a store reconcile whenever usage moves, and the final
    // turn usage lands right AFTER the turn ends (the `resting` agent_idle has
    // already rested the node at 'idle'). Forcing 'thinking' flipped that just
    // -rested node back to a permanent "Thinking" pulse — the agent looked busy
    // forever once it went idle. Preserve `agent.state`; real activity
    // (message/tool events) is what moves a node into 'thinking'/'tool_calling'.
    state.agents.set(agentName, {
      ...agent,
      tokensUsed: tokens ?? agent.tokensUsed,
      ...(cumulativeTokens !== undefined ? { cumulativeTokens } : {}),
      tokensMax: tokensMaxOverride ?? agent.tokensMax,
      contextBreakdown: breakdown || agent.contextBreakdown,
    })
  }
}
