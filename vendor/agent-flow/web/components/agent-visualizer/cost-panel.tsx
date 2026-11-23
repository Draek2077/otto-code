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
import { agentCost, formatCost, toolTypeColor } from './canvas/draw-cost'
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

  const agentList = Array.from(agents.values())

  // OTTO PATCH (OTTO-PATCHES.md): `cost` is the host's REAL reported figure or
  // null — never tokens × a rate. Rows sort by tokens rather than cost so an
  // unpriced agent (local model) still ranks by the work it actually did
  // instead of sinking to the bottom as a phantom $0.
  const agentBreakdown = agentList
    .map(a => ({ name: a.name, isMain: a.isMain, tokens: a.contextKnown === false ? null : agentTokens(a), cost: agentCost(a) }))
    .sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1))

  const totalTokens = agentBreakdown.reduce((s, a) => s + (a.tokens ?? 0), 0)
  const tokenRows = agentBreakdown.filter(a => a.tokens !== null).length
  const pricedRows = agentBreakdown.filter(a => a.cost !== null)
  const totalCost = pricedRows.reduce((s, a) => s + (a.cost ?? 0), 0)
  // A floor, not a total, when some of the graph could not be priced — say so
  // rather than presenting a partial sum as the whole bill.
  const costIsPartial = pricedRows.length > 0 && pricedRows.length < agentBreakdown.length
  const maxTokens = Math.max(...agentBreakdown.map(a => a.tokens ?? 0), Number.EPSILON)

  // OTTO PATCH: only an explicitly reported per-tool count enters this map.
  // The canonical adapter never estimates counts or prices from payload length.
  const toolMap = new Map<string, number>()
  for (const tc of toolCalls.values()) {
    if (!tc.tokenCost) continue
    toolMap.set(tc.toolName, (toolMap.get(tc.toolName) ?? 0) + tc.tokenCost)
  }
  const toolList = Array.from(toolMap.entries())
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  const maxToolTokens = Math.max(...toolList.map(t => t.tokens), Number.EPSILON)

  return (
    <SlidingPanel
      visible={visible}
      position={{ top: 42, right: 12 }}
      zIndex={Z.sidePanel}
      width={260}
    >
      <div className="glass-card relative" data-testid="visualizer-reported-cost">
        <PanelHeader>
          <span className="text-[10px] font-mono tracking-wider" style={{ color: COLORS.textPrimary }}>
            Reported cost
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
            const ratio = (a.tokens ?? 0) / maxTokens
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
                  {/* An em dash, not "$0.000": this provider reports no cost. */}
                  <span
                    className="text-[9px] font-mono"
                    style={{ color: a.cost === null ? COLORS.textMuted : COLORS.costText }}
                    title={a.cost === null ? 'This provider reports no cost' : undefined}
                  >
                    {a.cost === null ? '—' : formatCost(a.cost)}
                  </span>
                </div>

                <div className="mt-1">
                  <ProgressBar percent={ratio * 100} color={barColor} trackColor={COLORS.holoBg05} />
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
                    {a.tokens === null ? 'Token usage not reported' : `${formatTokens(a.tokens)} tokens`}
                  </span>
                </div>
              </div>
            )
          })}

          {/* By-tool breakdown is available only when the source reports it. */}
          {toolList.length > 0 && (
            <>
              <div className="text-[9px] font-mono tracking-wider pt-2 pb-0.5 px-1" style={{ color: COLORS.textMuted }}>
                By Tool (reported tokens)
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
                      <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
                        {formatTokens(t.tokens)}
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar percent={(t.tokens / maxToolTokens) * 100} color={heatColor} trackColor={COLORS.holoBg05} />
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
            {/* "≥" when part of the graph was unpriceable — a floor presented
                as a total is the same lie in a smaller font. Nothing at all
                when no agent here reports cost. */}
            <span style={{ color: COLORS.costText }}>
              {pricedRows.length === 0
                ? ''
                : `${costIsPartial ? '≥ ' : ''}${formatCost(totalCost)}`}
            </span>
            <span>{tokenRows === 0 ? 'Token usage not reported' : `${tokenRows < agentBreakdown.length ? '≥ ' : ''}${formatTokens(totalTokens)} tokens reported`}</span>
          </div>
        )}
      </div>
    </SlidingPanel>
  )
}
