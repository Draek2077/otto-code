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
}

export const TopBar = memo(function TopBar({ agentCount, totalTokens }: TopBarProps) {
  return (
    // Right-side info readout. Anchored top-right on its own; block wraps +
    // shrinks on narrow panes instead of overflowing off the right edge.
    <div
      className="absolute top-3 right-3 flex items-center justify-end gap-x-4 gap-y-1 flex-wrap font-mono text-[10px]"
      style={{ zIndex: Z.info, color: COLORS.textMuted, maxWidth: 'calc(100% - 6rem)' }}
    >
      <span className="whitespace-nowrap">{agentCount} agents</span>
      <span className="whitespace-nowrap">
        {formatTokens(totalTokens)} tokens
        <span style={{ color: COLORS.complete + '65', marginLeft: 4 }}>
          ~${agentCost(totalTokens).toFixed(2)}
        </span>
      </span>
    </div>
  )
})
