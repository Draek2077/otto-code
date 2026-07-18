import type { ContextBreakdown } from '@/lib/agent-types'
import type { ConversationMessage } from './types'
import { appendConversation, asString, LABEL_LEN_BUBBLE, MAX_BUBBLES } from './types'
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

  // Update agent state and push message bubble to queue
  const msgAgent = state.agents.get(agentName)
  if (msgAgent) {
    const bubbleRole: 'user' | 'thinking' | 'assistant' = role === 'user' ? 'user' : role === 'thinking' ? 'thinking' : 'assistant'
    const updates: Partial<typeof msgAgent> = {}

    {
      // Truncate thinking for graph bubbles (full text in message feed panel)
      const bubbleText = bubbleRole === 'thinking' ? content.slice(0, LABEL_LEN_BUBBLE) + (content.length > LABEL_LEN_BUBBLE ? '...' : '') : content
      // Dedup: skip if last bubble has the same text (dual event source race)
      const lastBubble = msgAgent.messageBubbles[msgAgent.messageBubbles.length - 1]
      if (!lastBubble || lastBubble.text !== bubbleText) {
        const newBubbles = [...msgAgent.messageBubbles, { text: bubbleText, time: currentTime, role: bubbleRole }]
        updates.messageBubbles = newBubbles.length > MAX_BUBBLES ? newBubbles.slice(-MAX_BUBBLES) : newBubbles
      }
    }

    if (msgAgent.state !== 'complete' && msgAgent.state !== 'tool_calling') {
      if (role === 'user' || role === 'thinking' || role === 'assistant') {
        updates.state = 'thinking'
      }
    }
    if (Object.keys(updates).length > 0) {
      state.agents.set(agentName, { ...msgAgent, ...updates })
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
    state.agents.set(agentName, {
      ...agent,
      tokensUsed: tokens ?? agent.tokensUsed,
      ...(cumulativeTokens !== undefined ? { cumulativeTokens } : {}),
      tokensMax: tokensMaxOverride ?? agent.tokensMax,
      contextBreakdown: breakdown || agent.contextBreakdown,
      state: agent.state === 'complete' ? 'complete' : 'thinking'
    })
  }
}
