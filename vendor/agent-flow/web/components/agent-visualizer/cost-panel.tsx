'use client'

// OTTO patch (OTTO-PATCHES.md): a DOM re-implementation of the top-right cost
// summary that used to be drawn on the canvas (drawCostSummaryPanel in
// canvas/draw-cost.ts). It mirrors FileAttentionPanel's glass-card layout,
// fonts, width, and top-right anchor so the mutually-exclusive Files/Cost pair
// reads as one panel in two modes. The on-node floating cost pills stay on the
// canvas (drawCostLabels) — only the summary panel moved to the DOM.

import { Agent, ToolCallNode, Z } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { formatTokens } from '@/lib/utils'
import { agentCost, toolTypeColor } from './canvas/draw-cost'
import { PanelHeader, ProgressBar, SlidingPanel } from './shared-ui'

interface CostPanelProps {
  visible: boolean
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
}

// OTTO PATCH: prefer each agent's honest lifetime total (cumulativeTokens) over
// context occupancy — matches the old canvas panel and the on-node cost pills.
const agentTokens = (a: Agent) => a.cumulativeTokens ?? a.tokensUsed

export function CostPanel({ visible, agents, toolCalls }: CostPanelProps) {
  if (!visible) return null

  const agentList = Array.from(agents.values()).filter(a => agentTokens(a) > 0)

  const agentBreakdown = agentList
    .map(a => ({ name: a.name, isMain: a.isMain, tokens: agentTokens(a), cost: agentCost(agentTokens(a), a.model) }))
    .sort((a, b) => b.cost - a.cost)

  const totalTokens = agentBreakdown.reduce((s, a) => s + a.tokens, 0)
  const totalCost = agentBreakdown.reduce((s, a) => s + a.cost, 0)
  const maxCost = Math.max(...agentBreakdown.map(a => a.cost), Number.EPSILON)

  // Per-tool-type breakdown, costed at the owning agent's model rate.
  const toolMap = new Map<string, { tokens: number; cost: number }>()
  for (const tc of toolCalls.values()) {
    if (!tc.tokenCost) continue
    const entry = toolMap.get(tc.toolName) ?? { tokens: 0, cost: 0 }
    entry.tokens += tc.tokenCost
    entry.cost += agentCost(tc.tokenCost, agents.get(tc.agentId)?.model)
    toolMap.set(tc.toolName, entry)
  }
  const toolList = Array.from(toolMap.entries())
    .map(([name, { tokens, cost }]) => ({ name, tokens, cost }))
    .sort((a, b) => b.cost - a.cost)
  const maxToolCost = Math.max(...toolList.map(t => t.cost), Number.EPSILON)

  return (
    <SlidingPanel
      visible={visible}
      position={{ top: 42, right: 12 }}
      zIndex={Z.sidePanel}
      width={260}
    >
      <div className="glass-card relative">
        <PanelHeader>
          <span className="text-[10px] font-mono tracking-wider" style={{ color: COLORS.textPrimary }}>
            Token Cost
          </span>
        </PanelHeader>

        {/* Breakdown list */}
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {agentBreakdown.length === 0 && (
            <div className="text-[9px] font-mono py-2 text-center" style={{ color: COLORS.textMuted }}>
              No cost data yet
            </div>
          )}

          {agentBreakdown.map((a) => {
            const ratio = a.cost / maxCost
            const barColor = a.isMain || agentBreakdown.length === 1 ? COLORS.barFillMain : COLORS.barFillSub
            return (
              <div
                key={a.name}
                className="rounded px-2 py-1.5"
                style={{
                  background: withAlpha(COLORS.toolCardBase, 0.5),
                  border: `1px solid ${barColor}30`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono truncate" style={{ color: COLORS.textPrimary, maxWidth: 160 }}>
                    {a.name}
                  </span>
                  <span className="text-[9px] font-mono" style={{ color: COLORS.costText }}>
                    ${a.cost.toFixed(3)}
                  </span>
                </div>

                <div className="mt-1">
                  <ProgressBar percent={ratio * 100} color={barColor} trackColor={COLORS.holoBg05} />
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
                    {formatTokens(a.tokens)} tokens
                  </span>
                </div>
              </div>
            )
          })}

          {/* By-tool breakdown */}
          {toolList.length > 0 && (
            <>
              <div className="text-[9px] font-mono tracking-wider pt-2 pb-0.5 px-1" style={{ color: COLORS.textMuted }}>
                By Tool
              </div>
              {toolList.map((t) => {
                const heatColor = toolTypeColor(t.name)
                return (
                  <div
                    key={t.name}
                    className="rounded px-2 py-1.5"
                    style={{
                      background: withAlpha(COLORS.toolCardBase, 0.5),
                      border: `1px solid ${heatColor}20`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="otto-code text-[9px] font-mono truncate" style={{ color: heatColor, maxWidth: 160 }}>
                        {t.name}
                      </span>
                      <span className="text-[9px] font-mono" style={{ color: COLORS.costTextDim }}>
                        ${t.cost.toFixed(3)}
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar percent={(t.cost / maxToolCost) * 100} color={heatColor} trackColor={COLORS.holoBg05} />
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Summary */}
        {agentBreakdown.length > 0 && (
          <div className="mt-2 pt-2 flex justify-between text-[9px] font-mono" style={{
            borderTop: `1px solid ${COLORS.holoBorder08}`,
            color: COLORS.textMuted,
          }}>
            <span style={{ color: COLORS.costText }}>${totalCost.toFixed(3)}</span>
            <span>{formatTokens(totalTokens)} tokens</span>
          </div>
        )}
      </div>
    </SlidingPanel>
  )
}
