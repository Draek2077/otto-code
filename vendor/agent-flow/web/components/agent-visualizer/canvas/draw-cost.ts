import { Agent, ToolCallNode, NODE } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { COST_RATE, MODEL_FAMILY_COST, COST_DRAW, STATS_OVERLAY, MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'
// OTTO PATCH (OTTO-PATCHES.md): the top-right cost SUMMARY panel moved to the
// DOM (../cost-panel.tsx). Only the on-node cost pills (drawCostLabels) remain
// on the canvas, so drawCostSummaryPanel and its formatTokens/truncateText/
// COST_PANEL imports were removed here. agentCost/toolTypeColor are still
// exported and are now reused by the DOM cost panel.

/** Blended $/M-token rate for a model ID — first matching family wins,
 *  unknown models fall back to the Sonnet-class rate. */
export function modelCostRate(model?: string): number {
  if (model) {
    const id = model.toLowerCase()
    for (const { pattern, rate } of MODEL_FAMILY_COST) {
      if (pattern.test(id)) return rate
    }
  }
  return COST_RATE
}

export function agentCost(tokensUsed: number, model?: string): number {
  return (tokensUsed / 1_000_000) * modelCostRate(model)
}

/** Tool name -> color for mini cost bar */
export function toolTypeColor(toolName: string): string {
  const n = toolName.toLowerCase()
  if (n.includes('read') || n.includes('glob') || n.includes('grep')) return COLORS.contextUser
  if (n.includes('edit') || n.includes('write')) return COLORS.contextReasoning
  if (n.includes('bash')) return COLORS.tool
  return COLORS.contextSubagent
}

/** Pre-group tool calls by agentId to avoid O(agents * toolCalls) per frame */
function groupToolsByAgent(toolCalls: Map<string, ToolCallNode>): Map<string, ToolCallNode[]> {
  const grouped = new Map<string, ToolCallNode[]>()
  for (const tc of toolCalls.values()) {
    if (!tc.tokenCost) continue
    let list = grouped.get(tc.agentId)
    if (!list) { list = []; grouped.set(tc.agentId, list) }
    list.push(tc)
  }
  return grouped
}

export function drawCostLabels(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  // OTTO PATCH (OTTO-PATCHES.md): whether the stats overlay is also on, so the
  // cost pill can lift above the stats box instead of overlapping it.
  showStats = false,
) {
  const toolsByAgent = groupToolsByAgent(toolCalls)

  for (const [, agent] of agents) {
    if (agent.opacity < MIN_VISIBLE_OPACITY) continue
    // OTTO PATCH (OTTO-PATCHES.md): cost pills prefer the honest lifetime total.
    const cost = agentCost(agent.cumulativeTokens ?? agent.tokensUsed, agent.model)
    if (cost < COST_DRAW.minDisplayCost) continue

    const r = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    // Mini tool-type bar draws below the pill only when this agent has tools
    // with token cost (groupToolsByAgent already filters out zero-cost tools).
    const agentTools = toolsByAgent.get(agent.id)
    const hasMiniBar = !!agentTools && agentTools.length > 0
    // OTTO PATCH (OTTO-PATCHES.md): stats box sits just above the node radius
    // (drawStatsOverlay); when it's showing for this node, lift the cost pill —
    // and the mini tool-type bar that hangs below it — clear above the stats
    // box, leaving STATS_OVERLAY.stackGap of clearance between them. Reserve the
    // mini bar's height only when it actually draws, so a node without one isn't
    // pushed needlessly far from the stats box. Stats only draws for non-complete
    // nodes, mirroring drawAgents.
    const liftAboveStats = showStats && agent.state !== 'complete'
    const miniBarReserve = hasMiniBar ? COST_DRAW.miniBarGap + COST_DRAW.miniBarHeight : 0
    const pillYOffset = liftAboveStats
      ? STATS_OVERLAY.yOffset + STATS_OVERLAY.stackGap + COST_DRAW.pillHeight + miniBarReserve
      : COST_DRAW.pillYOffset
    const pillY = agent.y - r - pillYOffset

    // Floating cost pill
    const label = `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
    ctx.font = 'bold 9px monospace'
    const labelW = ctx.measureText(label).width
    const pillW = labelW + COST_DRAW.pillPadding
    const pillH = COST_DRAW.pillHeight
    const pillX = agent.x - pillW / 2

    ctx.save()
    ctx.globalAlpha = agent.opacity * 0.9

    // Pill background
    ctx.fillStyle = COLORS.costPillBg
    ctx.strokeStyle = COLORS.costPillStroke
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, COST_DRAW.pillRadius)
    ctx.fill()
    ctx.stroke()

    // Cost text
    ctx.fillStyle = COLORS.costText
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, agent.x, pillY + pillH / 2)

    // Mini tool-type cost bar below the pill
    if (hasMiniBar && agentTools) {
      // Group by tool type
      const byType = new Map<string, number>()
      let totalToolTokens = 0
      for (const tc of agentTools) {
        const tokens = tc.tokenCost || 0
        const key = tc.toolName
        byType.set(key, (byType.get(key) || 0) + tokens)
        totalToolTokens += tokens
      }
      if (totalToolTokens > 0) {
        const barW = Math.min(pillW + COST_DRAW.miniBarMaxExtra, COST_DRAW.miniBarMax)
        const barH = COST_DRAW.miniBarHeight
        const barX = agent.x - barW / 2
        const barY = pillY + pillH + COST_DRAW.miniBarGap

        // Bar background
        ctx.fillStyle = COLORS.holoBorder06
        ctx.beginPath()
        ctx.roundRect(barX, barY, barW, barH, COST_DRAW.miniBarRadius)
        ctx.fill()

        // Segments
        let segX = barX
        for (const [toolName, tokens] of byType) {
          const segW = (tokens / totalToolTokens) * barW
          if (segW < 1) continue
          ctx.fillStyle = toolTypeColor(toolName)
          ctx.globalAlpha = agent.opacity * 0.7
          ctx.beginPath()
          ctx.roundRect(segX, barY, segW, barH, COST_DRAW.miniBarRadius)
          ctx.fill()
          segX += segW
        }
      }
    }

    ctx.restore()
  }
}
