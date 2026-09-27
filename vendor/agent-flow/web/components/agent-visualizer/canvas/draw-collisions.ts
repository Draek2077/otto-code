import type { Agent, FileCollisionNotice } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'

/** OTTO PATCH (OTTO-PATCHES.md): transient trail between agents whose file
 * touches overlapped. Cross-session notices still appear in the DOM strip
 * when one endpoint is outside the selected session. */
export function drawCollisionTrails(
  ctx: CanvasRenderingContext2D,
  collisions: Map<string, FileCollisionNotice>,
  agents: Map<string, Agent>,
  currentTime: number,
): void {
  for (const collision of collisions.values()) {
    const age = currentTime - collision.time
    if (age < 0 || age > 8) continue
    const left = agents.get(collision.leftAgent)
    const right = agents.get(collision.rightAgent)
    if (!left || !right || left.opacity <= 0 || right.opacity <= 0) continue
    ctx.save()
    ctx.globalAlpha = (1 - age / 8) * 0.8
    ctx.strokeStyle = COLORS.error
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(left.x, left.y)
    ctx.lineTo(right.x, right.y)
    ctx.stroke()
    ctx.restore()
  }
}
