"use client"

import { memo } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { formatTokens } from "@/lib/utils"
import { agentCost } from "./canvas/draw-cost"
import { SessionTabs } from "./session-tabs"
import type { SessionInfo } from "@/lib/bridge-types"

// ─── Mute/Unmute SVG Icons ───────────────────────────────────────────────────

function MutedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function UnmutedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

// ─── Toggle Button ──────────────────────────────────────────────────────────

function ToggleButton({ active, onClick, children, style, activeColor }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  style?: React.CSSProperties
  activeColor?: { bg: string; text: string }
}) {
  return (
    <button
      onClick={onClick}
      className="px-1.5 py-0.5 rounded transition-all"
      style={{
        background: active ? (activeColor?.bg ?? COLORS.toggleActive) : COLORS.toggleInactive,
        border: `1px solid ${COLORS.toggleBorder}`,
        color: active ? (activeColor?.text ?? COLORS.holoBright) : COLORS.textMuted,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ─── Top Bar ────────────────────────────────────────────────────────────────

export interface TopBarProps {
  // Session tabs
  sessions: SessionInfo[]
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  // Stats
  agentCount: number
  totalTokens: number
  // Panel toggles
  showFileAttention: boolean
  showCostOverlay: boolean
  showTimeline: boolean
  isMuted: boolean
  onTogglePanel: (panel: 'files' | 'cost') => void
  onToggleTimeline: () => void
  onToggleMute: () => void
}

export const TopBar = memo(function TopBar({
  sessions, selectedSessionId, sessionsWithActivity,
  onSelectSession, onCloseSession,
  agentCount, totalTokens,
  showFileAttention, showCostOverlay, showTimeline, isMuted,
  onTogglePanel, onToggleTimeline, onToggleMute,
}: TopBarProps) {
  return (
    <>
      {/* Session tabs — vertical column down the LEFT edge.
          OTTO PATCH (see OTTO-PATCHES.md): render from one session up (upstream
          hid the bar below two), so the embed always shows WHICH chat the graph
          is visualizing. Pulled out of the shared top row into its own
          absolutely-positioned left column at a higher z-index than the
          right-side toolbar, so the toolbar can never overlap/clip it, and
          stacked vertically ("tabs down the side"). Height-capped + scrollable
          via percentages (not vh — frozen in the Electron webview guest). */}
      {sessions.length > 0 && (
        <div
          className="absolute top-3 left-3 overflow-y-auto scrollbar-hide font-mono text-[10px]"
          style={{ zIndex: Z.info + 1, maxHeight: 'calc(100% - 6rem)' }}
        >
          <SessionTabs
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            sessionsWithActivity={sessionsWithActivity}
            onSelectSession={onSelectSession}
            onCloseSession={onCloseSession}
          />
        </div>
      )}

      {/* Right-side info/controls.
          OTTO PATCH (see OTTO-PATCHES.md): connection indicator removed (the
          embed is always connected to its own host — the status read as an
          optional link); "chats" -> "agents" (the count is graph nodes in the
          selected session, not session tabs); block wraps + shrinks on narrow
          panes instead of overflowing off the right edge. Anchored top-right on
          its own so it never shares a flex row with the session column. */}
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

        {/* Mutually exclusive panel group */}
        <div className="flex items-center gap-1 px-1 py-0.5 rounded" style={{
          background: COLORS.holoBg03,
          border: `1px solid ${COLORS.holoBorder06}`,
        }}>
          <ToggleButton active={showFileAttention} onClick={() => onTogglePanel('files')} style={{ background: showFileAttention ? undefined : 'transparent', border: 'none' }}>Files</ToggleButton>
          <ToggleButton
            active={showCostOverlay}
            onClick={() => onTogglePanel('cost')}
            activeColor={{ bg: COLORS.costActiveBg, text: COLORS.complete }}
            style={{ background: showCostOverlay ? undefined : 'transparent', border: 'none' }}
          >
            Cost
          </ToggleButton>
        </div>

        {/* Independent toggles */}
        <ToggleButton active={showTimeline} onClick={onToggleTimeline}>Timeline</ToggleButton>
        <ToggleButton active={!isMuted} onClick={onToggleMute} style={{ border: `1px solid ${COLORS.toggleBorder}` }}>
          {isMuted ? <MutedIcon /> : <UnmutedIcon />}
        </ToggleButton>
      </div>
    </>
  )
})
