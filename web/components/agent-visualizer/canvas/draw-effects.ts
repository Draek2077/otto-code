import { COLORS } from '@/lib/colors'
import { SPAWN_FX, COMPLETE_FX } from '@/lib/canvas-constants'
import { drawHexagon } from './draw-misc'
import { alphaHex } from '@/lib/utils'

export interface VisualEffect {
  type: 'spawn' | 'complete' | 'shatter'
  x: number
  y: number
  color: string
  age: number
  duration: number
  particles?: Array<{ angle: number; speed: number; size: number }>
}

export function drawEffects(ctx: CanvasRenderingContext2D, effects: VisualEffect[]) {
  for (const fx of effects) {
    const progress = fx.age / fx.duration
    ctx.save()

    switch (fx.type) {
      case 'spawn': {
        // Expanding hex ring + white flash
        const ringRadius = SPAWN_FX.ringStart + progress * SPAWN_FX.ringExpand
        const alpha = (1 - progress) * SPAWN_FX.maxAlpha

        // White flash (quick, first 30%)
        if (progress < SPAWN_FX.flashThreshold) {
          const flashAlpha = (1 - progress / SPAWN_FX.flashThreshold) * SPAWN_FX.flashAlpha
          ctx.beginPath()
          ctx.arc(fx.x, fx.y, SPAWN_FX.flashBaseRadius * (1 - progress / SPAWN_FX.flashThreshold) + SPAWN_FX.flashMinRadius, 0, Math.PI * 2)
          ctx.fillStyle = COLORS.holoHot + alphaHex(flashAlpha)
          ctx.fill()
        }

        // Expanding hexagonal ring
        ctx.globalAlpha = alpha
        drawHexagon(ctx, fx.x, fx.y, ringRadius)
        ctx.strokeStyle = fx.color
        ctx.lineWidth = 2 * (1 - progress)
        ctx.stroke()

        // Scatter particles outward
        for (let i = 0; i < SPAWN_FX.particleCount; i++) {
          const a = (i / SPAWN_FX.particleCount) * Math.PI * 2
          const d = ringRadius * 0.8 + progress * 20
          const px = fx.x + Math.cos(a) * d
          const py = fx.y + Math.sin(a) * d
          ctx.beginPath()
          ctx.fillStyle = fx.color + alphaHex(alpha * (200 / 255))
          ctx.arc(px, py, SPAWN_FX.particleSize * (1 - progress), 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }

      case 'complete': {
        // White flash + expanding ring that fades
        const ringRadius = COMPLETE_FX.ringStart + progress * COMPLETE_FX.ringExpand
        const alpha = (1 - progress) * COMPLETE_FX.maxAlpha

        // Bright white flash (first 20%)
        if (progress < COMPLETE_FX.flashThreshold) {
          const flashAlpha = (1 - progress / COMPLETE_FX.flashThreshold) * COMPLETE_FX.flashAlpha
          const grad = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, COMPLETE_FX.flashRadius)
          grad.addColorStop(0, COLORS.holoHot + alphaHex(flashAlpha))
          grad.addColorStop(1, COLORS.holoHot + '00')
          ctx.fillStyle = grad
          ctx.fillRect(fx.x - COMPLETE_FX.flashRadius, fx.y - COMPLETE_FX.flashRadius, COMPLETE_FX.flashRadius * 2, COMPLETE_FX.flashRadius * 2)
        }

        // Expanding ring
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.arc(fx.x, fx.y, ringRadius, 0, Math.PI * 2)
        ctx.strokeStyle = fx.color
        ctx.lineWidth = COMPLETE_FX.lineWidthMax * (1 - progress)
        ctx.stroke()

        // Glow behind ring
        const grad = ctx.createRadialGradient(fx.x, fx.y, ringRadius - COMPLETE_FX.glowInner, fx.x, fx.y, ringRadius + COMPLETE_FX.glowOuter)
        grad.addColorStop(0, fx.color + '00')
        grad.addColorStop(0.5, fx.color + alphaHex(alpha * (100 / 255)))
        grad.addColorStop(1, fx.color + '00')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(fx.x, fx.y, ringRadius + COMPLETE_FX.glowOuter, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      case 'shatter': {
        // Particles scatter outward from tool card
        if (!fx.particles) break
        const alpha = (1 - progress) * 0.8
        ctx.globalAlpha = alpha

        for (const p of fx.particles) {
          const dist = p.speed * fx.age
          const px = fx.x + Math.cos(p.angle) * dist
          const py = fx.y + Math.sin(p.angle) * dist
          const size = p.size * (1 - progress * 0.7)

          ctx.beginPath()
          ctx.fillStyle = fx.color
          ctx.arc(px, py, size, 0, Math.PI * 2)
          ctx.fill()

          // Tiny glow on each particle
          ctx.beginPath()
          const glow = ctx.createRadialGradient(px, py, 0, px, py, size * 3)
          glow.addColorStop(0, fx.color + '40')
          glow.addColorStop(1, fx.color + '00')
          ctx.fillStyle = glow
          ctx.arc(px, py, size * 3, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
    }

    ctx.restore()
  }
}
