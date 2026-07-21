'use client'

import { useEffect, useRef, useState } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'

// OTTO PATCH (see OTTO-PATCHES.md): host-toggleable on-screen FPS meter.
// Counts the page's own requestAnimationFrame ticks — the same clock the canvas
// draw loop rides — so the number reflects real render throughput. Themed with
// the HUD holo palette (matches the top-bar toggle chrome) and pinned to the
// top-left corner — or the BOTTOM-left in compact ("mini"/PIP) mode, where the
// split stats readout takes the top-left corner and the bottom bar is hidden,
// so the bottom edge is the only free real estate. Mounted only while enabled
// (config.render.showFps), so its rAF loop costs nothing when off.
export function FpsMeter({ compact }: { compact?: boolean }) {
  const [fps, setFps] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    let frames = 0
    let last = performance.now()
    const tick = (now: number) => {
      frames++
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0
        last = now
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Tint the number by health, reusing the HUD state-palette tokens so the
  // meter stays on-theme (green = healthy, amber = caution, red = struggling).
  const fpsColor = fps >= 50 ? COLORS.complete : fps >= 30 ? COLORS.tool_calling : COLORS.error

  return (
    <div
      className={`absolute ${compact ? 'bottom-3' : 'top-3'} left-3 font-mono text-[10px] px-2 py-1 rounded flex items-center gap-1.5`}
      style={{
        zIndex: Z.info,
        background: COLORS.holoBg03,
        border: `1px solid ${COLORS.holoBorder06}`,
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: COLORS.textMuted }}>FPS</span>
      <span style={{ color: fpsColor }}>{fps}</span>
    </div>
  )
}
