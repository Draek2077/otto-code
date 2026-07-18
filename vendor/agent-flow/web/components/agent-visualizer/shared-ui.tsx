'use client'

import { useRef, type ReactNode } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { useClickOutside } from '@/hooks/use-click-outside'
import { clampPopupPosition } from '@/lib/clamp-popup-position'
import { GlassCard } from './glass-card'

// ─── Stop Propagation Handlers ──────────────────────────────────────────────
// Prevents canvas drag/click events from firing when interacting with panels

export const stopPropagationHandlers = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onMouseUp: (e: React.MouseEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
} as const

// ─── Close Button ───────────────────────────────────────────────────────────

interface CloseButtonProps {
  onClick: () => void
  className?: string
}

export function CloseButton({ onClick, className = '' }: CloseButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`text-xs transition-colors ${className}`}
      style={{ color: COLORS.textMuted }}
    >
      ✕
    </button>
  )
}

// ─── Panel Header ───────────────────────────────────────────────────────────

interface PanelHeaderProps {
  children: ReactNode
  // OTTO patch (OTTO-PATCHES.md): optional. Panels driven by an external
  // toggle button (Files/Cost/Timeline in Otto's toolbar) render no ✕ — the
  // toggle already closes them. Node-tethered popups still pass onClose.
  onClose?: () => void
  className?: string
  actions?: ReactNode
}

export function PanelHeader({ children, onClose, className = 'mb-2', actions }: PanelHeaderProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {children}
      </div>
      {(actions || onClose) && (
        <div className="flex items-center gap-1">
          {actions}
          {onClose && <CloseButton onClick={onClose} />}
        </div>
      )}
    </div>
  )
}

// ─── Detail Popup ──────────────────────────────────────────────────────────
// Shared wrapper for popup detail cards (tool detail, discovery detail, etc.)

interface DetailPopupProps {
  position: { x: number; y: number }
  width: number
  estimatedHeight: number
  onClose: () => void
  children: ReactNode
}

export function DetailPopup({ position, width, estimatedHeight, onClose, children }: DetailPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { left, top } = clampPopupPosition(position, width, estimatedHeight)

  useClickOutside(ref, onClose)

  return (
    <div
      ref={ref}
      {...stopPropagationHandlers}
      style={{ position: 'absolute', left, top, width, zIndex: Z.detailCard }}
    >
      <GlassCard visible={true}>
        {children}
      </GlassCard>
    </div>
  )
}

// ─── Sliding Panel ──────────────────────────────────────────────────────────
// Shared wrapper for panels that slide in/out with a visibility transition.

interface SlidingPanelProps {
  visible: boolean
  /** CSS positioning — e.g. { top: 12, right: 3 } */
  position: React.CSSProperties
  /** Slide direction: 'X' slides horizontally, 'Y' slides vertically */
  axis?: 'X' | 'Y'
  /** Pixel offset when hidden (default 20) */
  offset?: number
  zIndex: number
  width?: number | string
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

export function SlidingPanel({
  visible, position, axis = 'X', offset = 20,
  zIndex, width, className = '', style, children,
}: SlidingPanelProps) {
  return (
    <div
      className={`absolute transition-all duration-300 ${className}`}
      style={{
        ...position,
        opacity: visible ? 1 : 0,
        transform: `translate${axis}(${visible ? 0 : offset}px)`,
        pointerEvents: visible ? 'auto' : 'none',
        zIndex,
        width,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

interface ProgressBarProps {
  percent: number
  color: string
  trackColor?: string
}

export function ProgressBar({ percent, color, trackColor = COLORS.holoBg10 }: ProgressBarProps) {
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ background: trackColor }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${percent}%`,
          background: color,
          boxShadow: `0 0 6px ${color}40`,
        }}
      />
    </div>
  )
}
