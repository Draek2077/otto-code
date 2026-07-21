import { Agent, NODE, ANIM, type ContextDisplay, type NodeShape } from '@/lib/agent-types'
import { COLORS, getStateColor, contextSegments } from '@/lib/colors'
import {
  AGENT_DRAW, CONTEXT_BAR, CONTEXT_RING, STATS_OVERLAY,
} from '@/lib/canvas-constants'
import { alphaHex, formatTokens, mixHex } from '@/lib/utils'
import { truncateText, drawNodeShape, CLAUDE_SPARK_D, OPENAI_LOGO_D, OPENAI_LOGO_VIEWBOX } from './draw-misc'
import { getAgentGlowSprite } from './render-cache'

// OTTO PATCH (OTTO-PATCHES.md): stable per-node phase in [0, 1), hashed from the
// agent id. Periodic node animations (scanline sweep, orbiting dots) add this as
// a phase offset so each node runs on its own timing instead of every node moving
// in lockstep. Keyed off the id (not spawnTime) so nodes dispatched in the same
// frame — a parent and its subagents — still desync. Cached because it's queried
// every frame for every node.
const _nodePhaseCache = new Map<string, number>()
function nodePhase(id: string): number {
  const cached = _nodePhaseCache.get(id)
  if (cached !== undefined) return cached
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const phase = ((h >>> 0) % 10000) / 10000
  _nodePhaseCache.set(id, phase)
  return phase
}

let _claudeSparkPath: Path2D | null = null
export function getClaudeSparkPath() {
  if (!_claudeSparkPath) _claudeSparkPath = new Path2D(CLAUDE_SPARK_D)
  return _claudeSparkPath
}

let _openaiLogoPath: Path2D | null = null
function getOpenAILogoPath() {
  if (!_openaiLogoPath) _openaiLogoPath = new Path2D(OPENAI_LOGO_D)
  return _openaiLogoPath
}

export function drawClaudeSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  const scale = (r * AGENT_DRAW.sparkScale) / AGENT_DRAW.sparkViewBox
  ctx.scale(scale, scale)
  ctx.translate(-AGENT_DRAW.sparkViewBox, -AGENT_DRAW.sparkViewBox + 1)
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6 / scale
  ctx.fill(getClaudeSparkPath())
  ctx.restore()
}

export function drawOpenAILogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  // Target diameter matches the Claude spark: (r * sparkScale) total.
  const scale = (r * AGENT_DRAW.sparkScale) / OPENAI_LOGO_VIEWBOX
  ctx.scale(scale, scale)
  ctx.translate(-OPENAI_LOGO_VIEWBOX / 2, -OPENAI_LOGO_VIEWBOX / 2)
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6 / scale
  ctx.fill(getOpenAILogoPath())
  ctx.restore()
}

/** Generic mark for runtimes with no bespoke brand asset — a hollow diamond,
 * matching the sub-agent glyph style rather than inventing new iconography. */
function drawGenericRuntimeMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  ctx.font = `${r * AGENT_DRAW.sparkScale}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('◇', cx, cy)
  ctx.restore()
}

/** Pick the brand logo for the agent's runtime. Defaults to Claude. Only
 * Claude/Codex have real brand marks (TRADEMARK.md forbids shipping
 * others') — every other known runtime gets the generic diamond mark. */
export function drawAgentBrand(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, color: string,
  runtime: Agent['runtime'],
) {
  if (runtime === 'codex') drawOpenAILogo(ctx, cx, cy, r, color)
  else if (runtime === undefined || runtime === 'claude') drawClaudeSpark(ctx, cx, cy, r, color)
  else drawGenericRuntimeMark(ctx, cx, cy, r, color)
}

export function drawContextComposition(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
  // OTTO PATCH (OTTO-PATCHES.md): 'bar' is upstream's segmented bar + token
  // label beneath it; 'label' drops the bar and lifts the token label into the
  // bar's own slot, for hosts that show context as the ring instead (the ring
  // and the bar are the same number drawn twice).
  mode: 'bar' | 'label' = 'bar',
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const barWidth = Math.max(CONTEXT_BAR.minWidth, radius * CONTEXT_BAR.widthMultiplier)
  const barHeight = CONTEXT_BAR.barHeight
  const barX = agent.x - barWidth / 2
  const barY = agent.y + radius + CONTEXT_BAR.yOffset
  const labelOnly = mode === 'label'

  // Background — sized to whatever this mode actually draws.
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(
    barX - 2,
    barY - 2,
    barWidth + 4,
    labelOnly ? CONTEXT_BAR.fontSize + 4 : barHeight + 14,
    CONTEXT_BAR.borderRadius,
  )
  ctx.fill()

  // Label — in the bar's place when the bar is hidden, below it otherwise.
  // textBaseline is explicit: drawAgentLabel leaves 'top' set, and the label-only
  // Y math below is written against the text's TOP edge so it tucks right under
  // the node name instead of floating a line-height lower.
  ctx.fillStyle = COLORS.textMuted
  ctx.font = `${CONTEXT_BAR.fontSize}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(
    `${formatTokens(total)} / ${formatTokens(agent.tokensMax)} tokens`,
    agent.x,
    labelOnly ? barY : barY + barHeight + CONTEXT_BAR.labelPadding,
  )

  if (labelOnly) return

  // Segments
  const segments = contextSegments(bd)

  let x = barX
  const maxWidth = barWidth * (total / agent.tokensMax)

  for (const seg of segments) {
    if (seg.value <= 0) continue
    const segWidth = (seg.value / total) * maxWidth
    ctx.fillStyle = seg.color
    ctx.fillRect(x, barY, segWidth, barHeight)
    x += segWidth
  }

  // Remaining capacity
  if (x < barX + barWidth) {
    ctx.fillStyle = COLORS.holoBg05
    ctx.fillRect(x, barY, barX + barWidth - x, barHeight)
  }

  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 0.5
  ctx.strokeRect(barX, barY, barWidth, barHeight)
}

export function drawContextRing(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
  time: number,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const usage = total / agent.tokensMax
  const ringR = radius + CONTEXT_RING.ringOffset
  const ringW = CONTEXT_RING.ringWidth
  const startAngle = -Math.PI / 2

  // Background ring (empty capacity)
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.holoBorder06
  ctx.lineWidth = ringW
  ctx.stroke()

  // Filled segments
  const segments = contextSegments(bd)

  let currentAngle = startAngle
  for (const seg of segments) {
    if (seg.value <= 0) continue
    const sweep = (seg.value / agent.tokensMax) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR, currentAngle, currentAngle + sweep)
    ctx.strokeStyle = seg.color
    ctx.lineWidth = ringW
    ctx.stroke()
    currentAngle += sweep
  }

  // Warning glow at high usage
  if (usage > CONTEXT_RING.warningThreshold) {
    const warningColor = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : COLORS.tool
    const intensity = usage > CONTEXT_RING.criticalThreshold
      ? 0.35 + Math.sin(time * 6) * 0.2
      : 0.15 + Math.sin(time * 3) * 0.1

    ctx.save()
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR + CONTEXT_RING.glowPadding, 0, Math.PI * 2)
    ctx.strokeStyle = warningColor
    ctx.lineWidth = CONTEXT_RING.glowLineWidth
    ctx.globalAlpha = intensity
    ctx.shadowColor = warningColor
    ctx.shadowBlur = CONTEXT_RING.glowBlur
    ctx.stroke()
    ctx.restore()
  }

  // Percentage label when usage is high
  if (usage > CONTEXT_RING.percentLabelThreshold) {
    ctx.font = `${CONTEXT_BAR.fontSize}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : usage > CONTEXT_RING.warningThreshold ? COLORS.tool : COLORS.textDim
    ctx.fillText(`${Math.floor(usage * 100)}%`, agent.x, agent.y - radius - CONTEXT_RING.percentYOffset)
  }
}

function drawDepthShadow(ctx: CanvasRenderingContext2D, agent: Agent, r: number, shape: NodeShape) {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = AGENT_DRAW.shadowBlur
  ctx.shadowOffsetX = AGENT_DRAW.shadowOffsetX
  ctx.shadowOffsetY = AGENT_DRAW.shadowOffsetY
  drawNodeShape(ctx, agent.x, agent.y, r * 0.9, shape)
  ctx.fillStyle = COLORS.cardBgFaintOverlay
  ctx.fill()
  ctx.restore()
}

function drawAgentGlow(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isSelected: boolean, isWaiting: boolean, shape: NodeShape, fill: { a: string; b: string } | null, showGlow: boolean) {
  // OTTO PATCH: the soft radial halo ("glow on things") is the host-toggleable
  // per-node glow (config.render.nodeGlow). Only the halo sprite is gated — the
  // ambient outer ring and the node-body fill below always draw, so a node with
  // glow off still renders fully, just without the surrounding bloom-like halo.
  if (showGlow) {
    const glowR = r + AGENT_DRAW.glowPadding
    const glowAlpha = isHovered || isSelected ? 0.35 : isWaiting ? 0.3 : agent.state === 'thinking' ? 0.2 : 0.1
    // Pre-rendered glow sprite instead of per-frame gradient creation
    const sprite = getAgentGlowSprite(color, Math.round(r * 0.5), Math.ceil(glowR), alphaHex(glowAlpha))
    ctx.drawImage(sprite, agent.x - Math.ceil(glowR), agent.y - Math.ceil(glowR))
  }

  // Ambient outer ring
  drawNodeShape(ctx, agent.x, agent.y, r + AGENT_DRAW.outerRingOffset, shape)
  ctx.strokeStyle = color + '25'
  ctx.lineWidth = 1
  ctx.stroke()

  // Inner fill. OTTO PATCH (OTTO-PATCHES.md): a personality-backed node in its
  // idle/thinking state fills with a top→bottom gradient of the personality's
  // two identity colors (already muted/vivid by resolveNodeAppearance);
  // everything else keeps the neutral dark interior. The gradient is cached and
  // origin-centered (drawn under a translate) so the steady state allocates no
  // CanvasGradient per node per frame.
  if (fill) {
    ctx.save()
    ctx.translate(agent.x, agent.y)
    drawNodeShape(ctx, 0, 0, r, shape)
    ctx.fillStyle = getPersonaFillGradient(ctx, fill, r)
    ctx.fill()
    ctx.restore()
  } else {
    drawNodeShape(ctx, agent.x, agent.y, r, shape)
    ctx.fillStyle = COLORS.nodeInterior
    ctx.fill()
  }
}

// OTTO PATCH: persona fill gradients keyed by color pair + quantized radius.
// The node radius breathes by fractions of a pixel each frame; quantizing to
// half-pixel buckets keeps the cache tiny while the gradient endpoints stay
// visually indistinguishable from the exact radius. CanvasGradient objects are
// context-independent, so one cache serves every draw.
const personaFillGradientCache = new Map<string, CanvasGradient>()

function getPersonaFillGradient(ctx: CanvasRenderingContext2D, fill: { a: string; b: string }, r: number): CanvasGradient {
  const qr = Math.round(r * 2) / 2
  const key = `${fill.a}|${fill.b}|${qr}`
  let grad = personaFillGradientCache.get(key)
  if (!grad) {
    if (personaFillGradientCache.size > 256) personaFillGradientCache.clear()
    grad = ctx.createLinearGradient(0, -qr, 0, qr)
    grad.addColorStop(0, fill.a)
    grad.addColorStop(1, fill.b)
    personaFillGradientCache.set(key, grad)
  }
  return grad
}

function drawScanline(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isWaiting: boolean, time: number, shape: NodeShape) {
  const baseScanSpeed = agent.state === 'thinking' || isHovered || isWaiting ? ANIM.scanline.thinking : ANIM.scanline.normal
  // OTTO PATCH: per-node phase AND per-node speed so each node's scanline runs on
  // its own timing. Phase (in px over the r*2 sweep) shifts where the line starts;
  // the speed jitter (±25%, hashed from the id) makes the up/down cadence itself
  // differ, so nodes drift apart over time instead of sweeping in lockstep.
  const phase = nodePhase(agent.id)
  const scanSpeed = baseScanSpeed * (0.75 + nodePhase(agent.id + '~') * 0.5)
  const scanY = agent.y - r + ((time * scanSpeed + phase * r * 2) % (r * 2))
  ctx.save()
  drawNodeShape(ctx, agent.x, agent.y, r, shape)
  ctx.clip()
  const scanGrad = ctx.createLinearGradient(agent.x, scanY - AGENT_DRAW.scanlineHalfH, agent.x, scanY + AGENT_DRAW.scanlineHalfH)
  const scanAlpha = isHovered ? '35' : '20'
  scanGrad.addColorStop(0, color + '00')
  scanGrad.addColorStop(0.5, color + scanAlpha)
  scanGrad.addColorStop(1, color + '00')
  ctx.fillStyle = scanGrad
  ctx.fillRect(agent.x - r, scanY - AGENT_DRAW.scanlineHalfH, r * 2, AGENT_DRAW.scanlineWidth)
  ctx.restore()
}

function drawStateRing(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isSelected: boolean, isWaiting: boolean, time: number, shape: NodeShape) {
  drawNodeShape(ctx, agent.x, agent.y, r, shape)
  ctx.strokeStyle = color
  ctx.lineWidth = (isSelected || isHovered) ? 2.5 : 2
  if (agent.state === 'complete') {
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = color + '60'
  } else if (isWaiting) {
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = -time * AGENT_DRAW.waitingDashSpeed
    ctx.lineWidth = 2.5
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

function drawCenterIcon(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isWaiting: boolean) {
  if (isWaiting) {
    // Geometric lock icon — fits the holographic style
    const s = r * 0.3
    ctx.save()
    ctx.strokeStyle = color + '90'
    ctx.fillStyle = color + '90'
    ctx.lineWidth = 1.5
    // Lock body (rounded rect)
    ctx.beginPath()
    ctx.roundRect(agent.x - s * 0.6, agent.y - s * 0.1, s * 1.2, s * 1.0, 2)
    ctx.fill()
    // Lock shackle (arc)
    ctx.beginPath()
    ctx.arc(agent.x, agent.y - s * 0.15, s * 0.4, Math.PI, 0)
    ctx.stroke()
    ctx.restore()
  } else if (agent.isMain) {
    drawAgentBrand(ctx, agent.x, agent.y, r, color + '90', agent.runtime)
  } else {
    ctx.fillStyle = color + '90'
    ctx.font = `${r * AGENT_DRAW.subIconScale}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(agent.state === 'tool_calling' ? '\u2699' : '\u25C7', agent.x, agent.y)
  }
}

function drawOrbitingParticles(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, time: number) {
  // OTTO PATCH: per-node angular phase so each node's dots orbit on their own
  // timing instead of every node's ring being rotationally in sync.
  const phaseAngle = nodePhase(agent.id) * Math.PI * 2
  for (let i = 0; i < 4; i++) {
    const angle = time * ANIM.orbitSpeed + (i / 4) * Math.PI * 2 + phaseAngle
    ctx.beginPath()
    ctx.fillStyle = color + '80'
    ctx.arc(
      agent.x + Math.cos(angle) * (r + AGENT_DRAW.orbitParticleOffset),
      agent.y + Math.sin(angle) * (r + AGENT_DRAW.orbitParticleOffset),
      AGENT_DRAW.orbitParticleSize, 0, Math.PI * 2,
    )
    ctx.fill()
  }
}

function drawWaitingRipples(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, time: number, shape: NodeShape) {
  // OTTO PATCH: per-node phase so waiting ripples/dots run on their own timing.
  const phase = nodePhase(agent.id)
  const phaseAngle = phase * Math.PI * 2
  // Radar ripples — 2 concentric rings expanding outward, staggered
  for (let i = 0; i < 2; i++) {
    const ripplePhase = ((time * 0.65 + i * 0.5 + phase) % 1.0)
    const rippleR = r + AGENT_DRAW.rippleInnerOffset + ripplePhase * AGENT_DRAW.rippleMaxExpand
    const rippleAlpha = (1 - ripplePhase) * AGENT_DRAW.rippleMaxAlpha
    drawNodeShape(ctx, agent.x, agent.y, rippleR, shape)
    ctx.strokeStyle = color + alphaHex(rippleAlpha)
    ctx.lineWidth = 1.5 * (1 - ripplePhase)
    ctx.stroke()
  }

  // Slower orbiting particles in amber
  for (let i = 0; i < 3; i++) {
    const angle = time * AGENT_DRAW.waitingOrbitSpeed + (i / 3) * Math.PI * 2 + phaseAngle
    ctx.beginPath()
    ctx.fillStyle = color + '70'
    ctx.arc(
      agent.x + Math.cos(angle) * (r + AGENT_DRAW.waitingOrbitOffset),
      agent.y + Math.sin(angle) * (r + AGENT_DRAW.waitingOrbitOffset),
      AGENT_DRAW.waitingOrbitParticleSize, 0, Math.PI * 2,
    )
    ctx.fill()
  }
}

// OTTO(label-pulse-stability): `labelR` is the node's base radius WITHOUT the
// per-frame breathe pulse (see drawAgents) so the label's bounding box — both
// its truncation width and its Y position — stays fixed while the node pulses.
// Feeding the pulsing radius here made `truncateText` re-solve every frame, so
// the ellipsis crawled in and out as the node breathed.
function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: Agent, labelR: number, isHovered: boolean) {
  ctx.fillStyle = isHovered ? COLORS.textPrimary : COLORS.textDim
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  // OTTO PATCH (see OTTO-PATCHES.md): per-tier multiplier so sub-agent labels
  // aren't disproportionately short just because their radius is smaller.
  const maxLabelW = labelR * (agent.isMain ? AGENT_DRAW.labelWidthMultiplier : AGENT_DRAW.labelWidthMultiplierSub)
  const agentLabel = truncateText(ctx, agent.name, maxLabelW)
  ctx.fillText(agentLabel, agent.x, agent.y + labelR + AGENT_DRAW.labelYOffset)
}

function drawStatsOverlay(ctx: CanvasRenderingContext2D, agent: Agent, r: number) {
  const sy = agent.y - r - STATS_OVERLAY.yOffset
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(agent.x - STATS_OVERLAY.boxWidth / 2, sy, STATS_OVERLAY.boxWidth, STATS_OVERLAY.boxHeight, STATS_OVERLAY.borderRadius)
  ctx.fill()
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 0.5
  ctx.stroke()
  ctx.fillStyle = COLORS.textMuted
  ctx.font = `${STATS_OVERLAY.fontSize}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${agent.toolCalls} tools \u00B7 ${agent.timeAlive.toFixed(1)}s`, agent.x, sy + STATS_OVERLAY.textPaddingY)
}

/** OTTO PATCH (OTTO-PATCHES.md): resolve a node's accent color (border/glow/
 *  scanline/brand glyph) and interior fill. A personality-backed agent
 *  (`agent.personaColor` set) tints ONLY its idle and thinking states in the
 *  personality's identity colors — muted when idle, vivid when thinking — so it
 *  reads as that personality without hiding activity. Every other state
 *  (tool_calling, waiting_permission, complete, error), and every agent with no
 *  personality, keeps the theme's state color and the neutral dark interior. */
function resolveNodeAppearance(agent: Agent): NodeAppearance {
  const persona = agent.personaColor
  if (persona && (agent.state === 'thinking' || agent.state === 'idle')) {
    const key = `${persona.a}|${persona.b}|${agent.state}`
    let cached = appearanceCache.get(key)
    if (!cached) {
      if (appearanceCache.size > 256) appearanceCache.clear()
      cached = agent.state === 'thinking'
        ? {
            accent: mixHex(persona.a, '#ffffff', 0.12),
            fill: { a: mixHex(persona.a, '#000000', 0.66), b: mixHex(persona.b, '#000000', 0.66) },
          }
        : {
            accent: mixHex(persona.a, '#3a3b40', 0.5),
            fill: { a: mixHex(persona.a, '#000000', 0.8), b: mixHex(persona.b, '#000000', 0.8) },
          }
      appearanceCache.set(key, cached)
    }
    return cached
  }
  return { accent: getStateColor(agent.state), fill: null }
}

// OTTO PATCH: the tints above are pure in (persona colors, state) and idle/
// thinking is the steady state, so memoize them — mixHex re-parses and
// re-formats hex strings on every call, which is pure churn at 60fps.
interface NodeAppearance { accent: string; fill: { a: string; b: string } | null }
const appearanceCache = new Map<string, NodeAppearance>()

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
  showStats: boolean,
  time: number,
  // OTTO PATCH: host-selected node silhouette (defaults to the historical hex).
  shape: NodeShape = 'hexagon',
  // OTTO PATCH: host toggle for the per-node glow halo sprite (config.render
  // .nodeGlow). Defaults on; gates only the soft halo, not the node body/ring.
  showNodeGlow: boolean = true,
  // OTTO PATCH: how the MAIN agent shows context occupancy (config.render
  // .contextDisplay). Upstream drew both the ring and the bar — the same
  // number twice. 'ring' keeps the ring and leaves only the token label under
  // the node; 'bar' keeps upstream's bar and drops the ring. Sub-agents have
  // no ring and always keep their bar.
  contextDisplay: ContextDisplay = 'ring',
) {
  for (const [id, agent] of agents) {
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const { accent: color, fill } = resolveNodeAppearance(agent)
    const isHovered = id === hoveredAgentId
    const isSelected = id === selectedAgentId

    const isWaiting = agent.state === 'waiting_permission'

    const breathe = isWaiting
      ? Math.sin(time * AGENT_DRAW.waitingBreatheSpeed) * AGENT_DRAW.waitingBreatheAmp + 1
      : agent.state === 'thinking'
      ? Math.sin(time * ANIM.breathe.thinkingSpeed) * ANIM.breathe.thinkingAmp + 1
      : agent.state === 'idle' ? Math.sin(time * ANIM.breathe.idleSpeed) * ANIM.breathe.idleAmp + 1 : 1

    const r = radius * breathe * agent.scale
    // Label radius excludes the breathe pulse so the label box doesn't oscillate
    // (see drawAgentLabel — OTTO(label-pulse-stability)). Keep agent.scale so the
    // label still tracks the one-time spawn/entry scale-in.
    const labelR = radius * agent.scale

    ctx.save()
    ctx.globalAlpha = agent.opacity

    drawDepthShadow(ctx, agent, r, shape)
    drawAgentGlow(ctx, agent, r, color, isHovered, isSelected, isWaiting, shape, fill, showNodeGlow)
    drawScanline(ctx, agent, r, color, isHovered, isWaiting, time, shape)
    drawStateRing(ctx, agent, r, color, isHovered, isSelected, isWaiting, time, shape)
    drawCenterIcon(ctx, agent, r, color, isWaiting)

    if (agent.state === 'thinking') {
      drawOrbitingParticles(ctx, agent, r, color, time)
    }

    if (isWaiting) {
      drawWaitingRipples(ctx, agent, r, color, time, shape)
    }

    drawAgentLabel(ctx, agent, labelR, isHovered)

    // Context composition — the main agent shows the ring OR the bar (OTTO
    // PATCH: it used to show both, which is the same value drawn twice); sub-
    // agents keep the bar.
    if (agent.state !== 'complete' || agent.opacity > 0.5) {
      const useRing = agent.isMain && contextDisplay === 'ring'
      if (useRing) {
        drawContextRing(ctx, agent, r, time)
      }
      drawContextComposition(ctx, agent, r, useRing ? 'label' : 'bar')
    }

    if (showStats && agent.state !== 'complete') {
      drawStatsOverlay(ctx, agent, r)
    }

    ctx.restore()
  }
}
