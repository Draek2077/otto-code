'use client'

import { useState } from 'react'
import type { FileCollisionNotice } from '@/lib/agent-types'
import { Z } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { stopPropagationHandlers } from './shared-ui'

interface CollisionStripProps {
  collisions: Map<string, FileCollisionNotice>
  onOpenFile?: (path: string) => void
}

/** OTTO PATCH (OTTO-PATCHES.md): compact, optional inspection for overlapping
 * file work. A cross-session collision has no drawable line in a single-chat
 * canvas, so it must remain discoverable here. */
export function CollisionStrip({ collisions, onOpenFile }: CollisionStripProps) {
  const [open, setOpen] = useState(false)
  if (collisions.size === 0) return null
  const rows = Array.from(collisions.values()).reverse()
  return (
    <div className="absolute top-3 left-3" style={{ zIndex: Z.sidePanel, maxWidth: 'min(320px, calc(100vw - 24px))' }} {...stopPropagationHandlers}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="glass-card px-2 py-1 text-[10px] font-mono"
        style={{ color: COLORS.error, border: `1px solid ${COLORS.error}45` }}
      >
        {rows.length} file overlap{rows.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="glass-card mt-1 p-2 space-y-1 max-h-[300px] overflow-y-auto">
          {rows.map(collision => (
            <div key={collision.id} className="rounded px-2 py-1.5" style={{ background: withAlpha(COLORS.toolCardBase, 0.5), border: `1px solid ${COLORS.error}30` }}>
              <div className="otto-code text-[10px] truncate" title={collision.path} style={{ color: COLORS.error }}>
                {collision.path}
              </div>
              <div className="text-[9px] leading-snug" style={{ color: COLORS.textPrimary }}>
                {collision.leftAgent} ({collision.leftMode}) · {collision.rightAgent} ({collision.rightMode})
              </div>
              {onOpenFile && (
                <button type="button" className="text-[9px] mt-1" style={{ color: COLORS.holoBase }} onClick={() => onOpenFile(collision.fileIdentity)}>
                  Open file
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
