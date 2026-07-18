import type { SimulationState } from './types'
import { MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'

/**
 * OTTO PATCH (OTTO-PATCHES.md): "jump to the settled end state" for a batch of
 * backfilled history the user did NOT watch happen live (see the `hydrate`
 * flag on SimulationEvent, threaded from the host's attach / visibility-regain
 * replay).
 *
 * Unlike {@link import('./snap-visual-state').snapVisualState} (used for the
 * timeline scrubber, which ages transients by a target *time*), this is
 * time-independent: the replayed history was all stamped at ~t0, so an age
 * based drop would keep everything. It hard-settles instead — every finished
 * tool card, every message bubble, every particle/discovery produced while
 * replaying the history is dropped, leaving only the resting node graph plus
 * whatever tool is still *running* right now ("what are they doing?"). Node
 * opacities are set to their settled values (>= MIN_VISIBLE_OPACITY) so the
 * canvas's own frame-diff effect detector treats the nodes as already-present
 * and fires no spawn burst.
 *
 * The event content itself still lives in `conversations` / `timelineEntries`
 * (built by the handlers during the replay), so the per-node chat panel and
 * the timeline keep the full history — only the transient *canvas* animation
 * is skipped.
 */
export function settleVisualState(state: SimulationState): SimulationState {
  const newAgents = new Map(state.agents)
  // Completed sub-agents dropped below leave the token sum — bank their totals
  // into retiredTokens so the top-bar token/cost readout stays honest, exactly
  // as animate.ts `cleanupFaded` does when a faded node is deleted.
  let retiredTokensDelta = 0
  for (const [id, agent] of newAgents) {
    // Completed sub-agents are already cleaned up in the live view — drop them
    // here too so the settled graph matches (the main/root agent survives even
    // when complete, at the dimmed 0.5 opacity, mirroring snapVisualState).
    if (agent.state === 'complete' && !agent.isMain) {
      retiredTokensDelta += agent.cumulativeTokens ?? agent.tokensUsed
      newAgents.delete(id)
      continue
    }
    newAgents.set(id, {
      ...agent,
      opacity: agent.state === 'complete' ? 0.5 : 1,
      scale: 1,
      messageBubbles: [],
    })
  }

  const newToolCalls = new Map(state.toolCalls)
  for (const [id, tc] of newToolCalls) {
    if (tc.state === 'running') {
      // Current activity — keep it visible; the animate loop ages it normally
      // from here (it fades if no further update arrives, like any live tool).
      newToolCalls.set(id, { ...tc, opacity: 1 })
    } else {
      // Finished/errored tool from the replayed history — drop the card.
      newToolCalls.delete(id)
    }
  }

  // Keep only edges whose endpoints both survived (mirrors snapVisualState).
  const newEdges = state.edges
    .map(e => {
      const fromAgent = newAgents.get(e.from)
      const toAgent = newAgents.get(e.to)
      const toTool = newToolCalls.get(e.to)
      const fromVisible = fromAgent && fromAgent.opacity > MIN_VISIBLE_OPACITY
      const toVisible = (toAgent && toAgent.opacity > MIN_VISIBLE_OPACITY) || (toTool && toTool.opacity > MIN_VISIBLE_OPACITY)
      return { ...e, opacity: (fromVisible && toVisible) ? 1 : 0 }
    })
    .filter(e => e.opacity > 0)

  return {
    ...state,
    agents: newAgents,
    toolCalls: newToolCalls,
    edges: newEdges,
    particles: [],
    discoveries: [],
    retiredTokens: (state.retiredTokens ?? 0) + retiredTokensDelta,
  }
}
