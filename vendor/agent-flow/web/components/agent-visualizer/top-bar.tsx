"use client"

import { memo } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { formatTokens } from "@/lib/utils"
import { agentCost } from "./canvas/draw-cost"

// ─── Top Bar ────────────────────────────────────────────────────────────────

// OTTO PATCH (see OTTO-PATCHES.md): the session-tab column and every control
// button (Files/Cost/Audio/eye AND the Timeline toggle) were pulled OUT of the
// HUD and into the native Otto toolbar above the visualizer tab (packages/app/
// src/panels/visualizer-toolbar.tsx). All that remains here is the top-right
// stats readout — still hidden by the HUD-eye like the rest of the HUD.
export interface TopBarProps {
  agentCount: number
  totalTokens: number
  /** OTTO PATCH (OTTO-PATCHES.md): compact ("mini") layout for the PIP surface
   * — see the split-corner note below. */
  compact?: boolean
}

export const TopBar = memo(function TopBar({ agentCount, totalTokens, compact }: TopBarProps) {
  const rowStyle = { zIndex: Z.info, color: COLORS.textMuted, maxWidth: 'calc(100% - 6rem)' }
  const tokens = (
    <span className="whitespace-nowrap">
      {formatTokens(totalTokens)} tokens
      <span style={{ color: COLORS.complete + '65', marginLeft: 4 }}>
        ~${agentCost(totalTokens).toFixed(2)}
      </span>
    </span>
  )

  // OTTO PATCH (OTTO-PATCHES.md): in the PIP ("mini") surface the readout is
  // split across both top corners instead of stacked in one right-hand block.
  // A ~240px-wide viewport makes the single block wrap onto two lines, which
  // eats the top of the graph; agent count pinned left + tokens pinned right
  // keeps it to one line at every PIP size.
  if (compact) {
    return (
      <>
        <div className="absolute top-3 left-3 font-mono text-[10px]" style={rowStyle}>
          <span className="whitespace-nowrap">{agentCount} agents</span>
        </div>
        <div className="absolute top-3 right-3 font-mono text-[10px]" style={rowStyle}>
          {tokens}
        </div>
      </>
    )
  }

  return (
    // Right-side info readout. Anchored top-right on its own; block wraps +
    // shrinks on narrow panes instead of overflowing off the right edge.
    <div
      className="absolute top-3 right-3 flex items-center justify-end gap-x-4 gap-y-1 flex-wrap font-mono text-[10px]"
      style={rowStyle}
    >
      <span className="whitespace-nowrap">{agentCount} agents</span>
      {tokens}
    </div>
  )
})
