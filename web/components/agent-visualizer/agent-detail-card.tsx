'use client'

import { CARD, Z, type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { formatTokens, formatModelName } from '@/lib/utils'
import { GlassCard } from './glass-card'
import { PanelHeader, ProgressBar } from './shared-ui'

interface AgentDetailCardProps {
  agent: {
    id: string
    name: string
    state: AgentState
    model?: string
    tokensUsed: number
    tokensMax: number
    toolCalls: number
    timeAlive: number
    currentTool?: string
  }
  onClose: () => void
}

export function AgentDetailCard({
  agent,
  onClose,
}: AgentDetailCardProps) {
  const contextPercent = Math.round((agent.tokensUsed / agent.tokensMax) * 100)
  const stateColor = getStateColor(agent.state)

  // Fixed position: middle-left of the screen (below message feed panel)
  const left = CARD.margin
  const top = typeof window !== 'undefined' ? Math.max(100, (window.innerHeight - CARD.detail.height) / 2) : 300

  return (
    <GlassCard
      visible={true}
      className="agent-detail-card"
      style={{
        position: 'absolute',
        left,
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

      {/* Stats row */}
      <div className="flex gap-3 mb-3 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
        <span>{agent.toolCalls} tools</span>
        <span>{agent.timeAlive.toFixed(1)}s alive</span>
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
