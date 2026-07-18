import {
  type Agent,
  type TimelineEntry,
  emptyContextBreakdown,
} from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { AGENT_SPAWN_DISTANCE } from '@/lib/canvas-constants'
import { pushTimelineBlock, type ProcessEventContext, type MutableEventState } from './process-event'
import { edgeId, asString, asBoolean } from './types'

const KNOWN_RUNTIMES = ['claude', 'codex', 'copilot', 'opencode', 'pi', 'openai-compat'] as const

export function handleAgentSpawn(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const name = asString(payload.name)
  const parentId = typeof payload.parent === 'string' ? payload.parent : undefined
  const isMain = asBoolean(payload.isMain)
  const task = typeof payload.task === 'string' ? payload.task : undefined
  const model = typeof payload.model === 'string' ? payload.model : undefined
  const runtime = KNOWN_RUNTIMES.includes(payload.runtime as typeof KNOWN_RUNTIMES[number])
    ? (payload.runtime as typeof KNOWN_RUNTIMES[number])
    : undefined
  // OTTO PATCH (OTTO-PATCHES.md): the personality's two identity colors, when
  // this agent was spawned from an Agent Personality. Both must be present to
  // count (a personality always carries a glow pair); otherwise the node stays
  // a normal state-driven one.
  const colorA = typeof payload.colorA === 'string' ? payload.colorA : undefined
  const colorB = typeof payload.colorB === 'string' ? payload.colorB : undefined
  const personaColor = colorA && colorB ? { a: colorA, b: colorB } : undefined

  // If the agent already exists (e.g. session resuming after inactivity),
  // reactivate it instead of replacing — preserves accumulated stats.
  const existing = state.agents.get(name)
  if (existing) {
    state.agents.set(name, {
      ...existing,
      state: 'idle',
      ...(task ? { task } : {}),
      ...(model ? { model, tokensMax: ctx.getContextWindowSize(model) } : {}),
      ...(runtime ? { runtime } : {}),
      ...(personaColor ? { personaColor } : {}),
    })
    return
  }

  let x = 0, y = 0
  if (parentId) {
    const parent = state.agents.get(parentId)
    if (parent) {
      // Collect angles of existing siblings so we can avoid spawning too close
      const siblingAngles: number[] = []
      for (const a of state.agents.values()) {
        if (a.parentId === parentId && a.id !== name) {
          siblingAngles.push(Math.atan2(a.y - parent.y, a.x - parent.x))
        }
      }

      let angle: number
      if (siblingAngles.length === 0) {
        // First child: use hash-based angle
        const hash = name.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
        angle = (Math.abs(hash) % 360) * (Math.PI / 180)
      } else {
        // Find the largest angular gap between existing siblings and place in the middle
        siblingAngles.sort((a, b) => a - b)
        let bestGap = 0
        let bestMid = 0
        for (let i = 0; i < siblingAngles.length; i++) {
          const next = i + 1 < siblingAngles.length ? siblingAngles[i + 1] : siblingAngles[0] + Math.PI * 2
          const gap = next - siblingAngles[i]
          if (gap > bestGap) {
            bestGap = gap
            bestMid = siblingAngles[i] + gap / 2
          }
        }
        angle = bestMid
      }

      x = parent.x + Math.cos(angle) * AGENT_SPAWN_DISTANCE
      y = parent.y + Math.sin(angle) * AGENT_SPAWN_DISTANCE
    }
  }

  const agent: Agent = {
    id: name, name, state: 'idle',
    parentId: parentId || null,
    tokensUsed: 0, tokensMax: ctx.getContextWindowSize(model),
    contextBreakdown: emptyContextBreakdown(),
    toolCalls: 0, timeAlive: 0,
    x, y, vx: 0, vy: 0,
    pinned: false, isMain,
    ...(runtime ? { runtime } : {}),
    ...(model ? { model } : {}),
    ...(personaColor ? { personaColor } : {}),
    task,
    spawnTime: currentTime,
    opacity: 0, scale: 0.3,
    messageBubbles: [],
  }
  state.agents.set(name, agent)

  if (parentId) {
    state.edges.push({ id: edgeId(parentId, name), from: parentId, to: name, type: 'parent-child', opacity: 0 })
  }

  const timelineEntry: TimelineEntry = {
    id: `timeline-${name}`,
    agentId: name,
    agentName: name,
    startTime: currentTime,
    blocks: [],
  }
  pushTimelineBlock(timelineEntry, currentTime, { type: 'idle', label: 'Starting', color: COLORS.idle }, ctx)
  state.timelineEntries.set(name, timelineEntry)

  state.conversations.set(name, [])

  if (!ctx.skipForceSync) {
    setTimeout(() => ctx.syncForceSimulation(state.agents, state.edges), 0)
  }
}

// OTTO PATCH (see OTTO-PATCHES.md): relabel a node's DISPLAY name in place.
// The agents map is keyed by the node's spawn name (`agent.id`), and every
// event/edge/timeline reference uses that same key — so a title change (the
// chat auto-title writer rewriting the root chat title after spawn) must NOT
// re-key the node. It only updates the shown label: `agent.name` (drawn under
// the node, see draw-agents.ts) and the timeline entry's `agentName`. Lookups
// stay keyed on the unchanged `payload.agent`.
export function handleAgentRename(
  payload: Record<string, unknown>,
  state: MutableEventState,
): void {
  const key = asString(payload.agent)
  const label = asString(payload.label)
  if (!key || !label) {
    return
  }
  const agent = state.agents.get(key)
  if (!agent || agent.name === label) {
    return
  }
  state.agents.set(key, { ...agent, name: label })
  const entry = state.timelineEntries.get(key)
  if (entry && entry.agentName !== label) {
    state.timelineEntries.set(key, { ...entry, agentName: label })
  }
}

export function handleAgentComplete(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const name = asString(payload.name)
  const agent = state.agents.get(name)
  if (agent && agent.state !== 'complete') {
    state.agents.set(name, { ...agent, state: 'complete', completeTime: currentTime })

    const entry = state.timelineEntries.get(name)
    if (entry) {
      pushTimelineBlock(entry, currentTime, { type: 'complete', label: 'Done', color: COLORS.complete, endTime: currentTime }, ctx)
      entry.endTime = currentTime
    }

    // OTTO PATCH (see OTTO-PATCHES.md): upstream cascaded completion to all
    // child agents here. Otto's host emits a real per-agent lifecycle for
    // every node, and a parent can legitimately finish while its spawned
    // children keep running (background Task handoff) — the cascade killed
    // those live child nodes. Each child now completes only on its own
    // agent_complete event.
    for (const [tcId, tc] of state.toolCalls) {
      if (tc.agentId === name && tc.state === 'running') {
        state.toolCalls.set(tcId, { ...tc, state: 'complete', completeTime: currentTime })
      }
    }
  }
}

export function handlePermissionRequested(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const agentName = asString(payload.agent, 'Orchestrator')
  const agent = state.agents.get(agentName)
  if (agent && agent.state !== 'complete') {
    state.agents.set(agentName, {
      ...agent,
      state: 'waiting_permission',
    })

    const entry = state.timelineEntries.get(agentName)
    if (entry) {
      pushTimelineBlock(entry, currentTime, { type: 'idle', label: 'Permission', color: COLORS.waiting_permission }, ctx)
    }
  }
}

export function handleAgentIdle(
  payload: Record<string, unknown>,
  state: MutableEventState,
): void {
  const idleName = asString(payload.name)
  const idleAgent = state.agents.get(idleName)
  if (!idleAgent || idleAgent.state === 'complete') {
    return
  }
  // OTTO PATCH (see OTTO-PATCHES.md): `resting: true` marks a real turn end —
  // the agent is done and waiting for input, so it rests at the dimmer 'idle'
  // state instead of pulsing 'thinking' forever. Without the flag this event
  // keeps its upstream meaning ("tool finished, back to reasoning").
  if (asBoolean(payload.resting)) {
    if (idleAgent.state !== 'idle') {
      state.agents.set(idleName, { ...idleAgent, state: 'idle', currentTool: undefined })
    }
    return
  }
  if (idleAgent.state === 'tool_calling' || idleAgent.state === 'waiting_permission') {
    state.agents.set(idleName, { ...idleAgent, state: 'thinking', currentTool: undefined })
  }
}

export function handleModelDetected(
  payload: Record<string, unknown>,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const agentName = asString(payload.agent)
  const model = asString(payload.model)
  const agent = state.agents.get(agentName)
  if (agent) {
    state.agents.set(agentName, {
      ...agent,
      model,
      tokensMax: ctx.getContextWindowSize(model),
    })
  }
}
