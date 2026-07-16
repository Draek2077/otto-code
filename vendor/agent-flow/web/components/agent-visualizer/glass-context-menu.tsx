'use client'

import { useRef } from 'react'
import { Z, TIMING } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { GlassCard } from './glass-card'
import { useClickOutside } from '@/hooks/use-click-outside'
import { stopPropagationHandlers } from './shared-ui'

interface ContextMenuProps {
  position: { x: number; y: number }
  items: Array<{
    label: string
    onClick: () => void
    danger?: boolean
    separator?: boolean
  }>
  onClose: () => void
}

export function GlassContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, onClose, TIMING.contextMenuDelayMs)

  return (
    <div
      ref={ref}
      {...stopPropagationHandlers}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: Z.contextMenu,
      }}
    >
      <GlassCard
        visible={true}
        style={{ minWidth: 160 }}
      >
        <div className="py-1">
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="my-1 h-px" style={{ background: COLORS.holoBg10 }} />
            ) : (
              <button
                key={i}
                onClick={() => {
                  item.onClick()
                  onClose()
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] font-mono transition-colors hover:bg-white/5"
                style={{ color: item.danger ? COLORS.error : COLORS.textPrimary }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      </GlassCard>
    </div>
  )
}
