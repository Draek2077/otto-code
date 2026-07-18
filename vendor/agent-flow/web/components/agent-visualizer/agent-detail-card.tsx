'use client'

import { CARD, Z, type AgentState, type ContextBreakdown } from '@/lib/agent-types'
import { COLORS, contextSegments, getStateColor } from '@/lib/colors'
import { formatTokens, formatModelName } from '@/lib/utils'
import { agentCost } from './canvas/draw-cost'
import { GlassCard } from './glass-card'
import { PanelHeader, ProgressBar } from './shared-ui'

interface AgentDetailCardProps {
  agent: {
    id: string
    name: string
    state: AgentState
    model?: string
    tokensUsed: number
    // OTTO PATCH: honest lifetime token total (context_update), distinct from
    // tokensUsed context occupancy — drives the cost estimate and a lifetime row.
    cumulativeTokens?: number
    tokensMax: number
    contextBreakdown: ContextBreakdown
    toolCalls: number
    timeAlive: number
    currentTool?: string
    task?: string
  }
  onClose: () => void
}

// OTTO PATCH (OTTO-PATCHES.md): labels for the five context-composition segments,
// index-aligned with `contextSegments` (system / user / tool results / reasoning /
// subagent results). The node's context ring shows these as proportions only; the
// card spells them out with token counts.
const SEGMENT_LABELS = ['System', 'User', 'Tools', 'Reasoning', 'Subagents'] as const

export function AgentDetailCard({
  agent,
  onClose,
}: AgentDetailCardProps) {
  const contextPercent = Math.round((agent.tokensUsed / agent.tokensMax) * 100)
  const stateColor = getStateColor(agent.state)

  // OTTO PATCH: enriched fields the node graph doesn't spell out — dollar cost
  // (from the honest lifetime total), the lifetime token count itself, and the
  // labeled context composition.
  const cost = agentCost(agent.cumulativeTokens ?? agent.tokensUsed, agent.model)
  const costLabel = `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
  const hasLifetime = typeof agent.cumulativeTokens === 'number' && agent.cumulativeTokens > agent.tokensUsed

  const segments = contextSegments(agent.contextBreakdown)
  const compositionTotal = segments.reduce((sum, s) => sum + (s.value || 0), 0)

  // OTTO PATCH (OTTO-PATCHES.md): pinned to the middle-RIGHT of the stage (was
  // middle-left). The per-node chat panel that used to sit bottom-right is
  // gone, so the right edge is free, and the user wants the node's details on
  // that side.
  const right = CARD.margin
  const top = typeof window !== 'undefined' ? Math.max(100, (window.innerHeight - CARD.detail.height) / 2) : 300

  return (
    <GlassCard
      visible={true}
      className="agent-detail-card"
      style={{
        position: 'absolute',
        right,
        top,
        width: CARD.detail.width,
        zIndex: Z.detailCard,
      }}
    >
      <PanelHeader onClose={onClose} className="mb-3">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: stateColor, boxShadow: `0 0 8px ${stateColor}` }}
        />
        <div className="flex flex-col">
          <span className="text-xs font-mono" style={{ color: COLORS.textPrimary }}>
            {agent.name}
          </span>
          {agent.model && (
            <span className="text-[9px] font-mono" style={{ color: COLORS.textDim }}>
              {formatModelName(agent.model)}
            </span>
          )}
        </div>
      </PanelHeader>

      {/* Task (what this agent was asked to do) */}
      {agent.task && (
        <div
          className="mb-3 text-[10px] leading-snug"
          style={{
            color: COLORS.textMuted,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {agent.task}
        </div>
      )}

      {/* Context bar */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-[10px]" style={{ color: COLORS.textMuted }}>Context</span>
          <span className="text-[10px] font-mono" style={{ color: COLORS.textDim }}>
            {formatTokens(agent.tokensUsed)} / {formatTokens(agent.tokensMax)} ({contextPercent}%)
          </span>
        </div>
        <ProgressBar percent={contextPercent} color={stateColor} />
      </div>

      {/* Context composition — labeled, with token counts (the node ring shows
          only proportions). Hidden when the host hasn't sent a breakdown. */}
      {compositionTotal > 0 && (
        <div className="mb-3">
          <div className="text-[10px] mb-1" style={{ color: COLORS.textMuted }}>Composition</div>
          <div className="flex h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: COLORS.holoBg10 }}>
            {segments.map((s, i) => (
              s.value > 0 ? (
                <div
                  key={SEGMENT_LABELS[i]}
                  style={{ width: `${(s.value / compositionTotal) * 100}%`, background: s.color }}
                />
              ) : null
            ))}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {segments.map((s, i) => (
              s.value > 0 ? (
                <span key={SEGMENT_LABELS[i]} className="flex items-center gap-1 text-[9px] font-mono" style={{ color: COLORS.textDim }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                  {SEGMENT_LABELS[i]} {formatTokens(s.value)}
                </span>
              ) : null
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
        <span style={{ color: COLORS.complete }}>{costLabel}</span>
        <span>{agent.toolCalls} tools</span>
        <span>{agent.timeAlive.toFixed(1)}s alive</span>
        {hasLifetime && <span>{formatTokens(agent.cumulativeTokens!)} total</span>}
        <span className="capitalize" style={{ color: stateColor }}>{agent.state}</span>
      </div>

      {/* Current tool */}
      {agent.currentTool && (
        <div
          className="mb-3 px-2 py-1.5 rounded text-[10px] font-mono flex items-center gap-2"
          style={{
            background: COLORS.toolIndicatorBg,
            border: `1px solid ${COLORS.toolIndicatorBorder}`,
            color: COLORS.toolIndicatorText,
          }}
        >
          <span className="animate-spin inline-block">⚙</span>
          {agent.currentTool}
        </div>
      )}

    </GlassCard>
  )
}
