'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { Agent, Particle, Edge, Discovery, DepthParticle, type ContextDisplay, type NodeShape } from '@/lib/agent-types'
import type { SimulationState } from '@/hooks/simulation/types'
import { getStateColor } from '@/lib/colors'
import { ANIM_SPEED, PERF_OVERLAY, PERF_OVERLAY_ENABLED } from '@/lib/canvas-constants'
import { BloomRenderer } from './bloom-renderer'
import { createDepthParticles, updateDepthParticles, drawBackground } from './background-layer'
import {
  type VisualEffect,
  drawTetherLine,
  drawEffects,
  drawAgents,
  drawMessageBubblesWorld,
  drawEdges, getActiveEdgeIds,
  drawParticles, buildEdgeMap,
  drawToolCalls,
  drawDiscoveries, drawDiscoveryConnections,
  drawCostLabels,
  detectStateChanges as detectStateChangesPure,
} from './canvas/index'
import { useCanvasCamera, type CameraFramingConfig } from '@/hooks/use-canvas-camera'
import { useCanvasInteraction } from '@/hooks/use-canvas-interaction'

interface CanvasProps {
  /** Ref to simulation state — read every frame without React re-renders */
  simulationRef: React.RefObject<SimulationState>
  selectedAgentId: string | null
  hoveredAgentId: string | null
  showStats: boolean
  zoomToFitTrigger?: number
  pauseAutoFit?: boolean
  onAgentClick: (agentId: string | null) => void
  onAgentHover: (agentId: string | null) => void
  onAgentDrag: (agentId: string, x: number, y: number) => void
  /** OTTO PATCH (OTTO-PATCHES.md): optional — the right-click menu was removed
   * from Otto's embed, so no callback is passed. Right-click still calls
   * preventDefault (use-canvas-interaction) to swallow the browser's menu. */
  onContextMenu?: (e: React.MouseEvent, type: 'agent' | 'edge' | 'canvas', id?: string) => void
  onToolCallClick?: (toolCallId: string | null) => void
  selectedToolCallId?: string | null
  onDiscoveryClick?: (discoveryId: string | null) => void
  selectedDiscoveryId?: string | null
  showCostOverlay?: boolean
  /** OTTO PATCH (see OTTO-PATCHES.md): host-toggleable render layers plus the
   * agent-node silhouette. Omitted keys (and an omitted object) keep every
   * layer on and the node shape at its historical hexagon. */
  renderOptions?: { bloom?: boolean; nodeGlow?: boolean; stars?: boolean; backdrop?: boolean; nodeShape?: NodeShape; contextDisplay?: ContextDisplay }
  /** OTTO PATCH (see OTTO-PATCHES.md): auto-fit framing profile. Omitted keys
   * keep the tab-tuned defaults; Otto's PIP sends a tighter profile because the
   * shared constants were tuned for a full-tab viewport. */
  cameraFraming?: CameraFramingConfig
}

export function AgentCanvas({
  simulationRef,
  selectedAgentId, hoveredAgentId, showStats, zoomToFitTrigger, pauseAutoFit,
  onAgentClick, onAgentHover, onAgentDrag, onContextMenu, onToolCallClick, selectedToolCallId, onDiscoveryClick, selectedDiscoveryId, showCostOverlay,
  renderOptions, cameraFraming,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mainCanvasRef = useRef<HTMLCanvasElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const animationRef = useRef<number>(0)
  const timeRef = useRef(0)
  const simTimeRef = useRef(0)
  const bloomRef = useRef<BloomRenderer | null>(null)
  const depthParticlesRef = useRef<DepthParticle[]>([])
  const lastFrameTimeRef = useRef(0)
  const dprRef = useRef(1)

  // Effects system
  const effectsRef = useRef<VisualEffect[]>([])
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map())
  const prevToolStatesRef = useRef<Map<string, string>>(new Map())

  // Rate-limited error logging for the draw loop (avoid flooding console)
  const lastDrawErrorRef = useRef(0)

  // Performance overlay state
  const perfRef = useRef({
    frames: 0,
    lastFpsUpdate: 0,
    fps: 0,
    frameTimeMs: 0,
    frameTimes: [] as number[],
    p95: 0,
  })

  // Caches for per-frame lookups — avoid rebuilding Set/Map every ~16ms
  const edgeLookupCacheRef = useRef<{
    particles: Particle[]
    edges: Edge[]
    activeEdgeIds: Set<string>
    edgeMap: Map<string, Edge>
  }>({ particles: [], edges: [], activeEdgeIds: new Set(), edgeMap: new Map() })

  // ─── Stable refs for animation loop & event handlers ────────────────────
  // Simulation data (agents, particles, etc.) is synced from simulationRef
  // at the top of each draw frame, so it's always fresh even without re-renders.
  const sim = simulationRef.current
  const makeDrawProps = (prev?: { isDragging: boolean }) => ({
    agents: sim.agents, toolCalls: sim.toolCalls,
    particles: sim.particles, edges: sim.edges, discoveries: sim.discoveries,
    selectedAgentId, hoveredAgentId, showStats,
    showCostOverlay, selectedToolCallId, selectedDiscoveryId,
    simTime: sim.currentTime, pauseAutoFit, dimensions,
    onAgentDrag, onAgentClick, onAgentHover, onContextMenu,
    onToolCallClick, onDiscoveryClick,
    isDragging: prev?.isDragging ?? false,
    renderOptions,
  })
  const drawPropsRef = useRef(makeDrawProps())
  drawPropsRef.current = makeDrawProps(drawPropsRef.current)

  // ─── Camera ─────────────────────────────────────────────────────────────
  const {
    transformRef, userHasNavigatedRef, panVelocityRef,
    screenToCanvas, doZoomToFit, updateCamera,
  } = useCanvasCamera({
    mainCanvasRef, drawPropsRef, simTimeRef, dimensions,
    agentCount: sim.agents.size, zoomToFitTrigger, selectedAgentId,
    framing: cameraFraming,
  })

  // ─── Interaction ────────────────────────────────────────────────────────
  const {
    isDragging, handlers, updateDragLerp,
  } = useCanvasInteraction({
    drawPropsRef, transformRef, userHasNavigatedRef, panVelocityRef,
    simTimeRef, screenToCanvas, doZoomToFit, mainCanvasRef,
  })

  // Keep drawPropsRef in sync with interaction state
  drawPropsRef.current.isDragging = isDragging

  // ─── Setup ──────────────────────────────────────────────────────────────

  // OTTO PATCH (see OTTO-PATCHES.md): dimensions the depth-particle field was
  // last laid out against, so a resize can remap star positions proportionally
  // instead of letting the draw loop's wrap logic collapse them (below).
  const particleDimsRef = useRef({ width: dimensions.width, height: dimensions.height })

  useEffect(() => {
    bloomRef.current = new BloomRenderer(0.5)
    depthParticlesRef.current = createDepthParticles(dimensions.width, dimensions.height)
    particleDimsRef.current = { width: dimensions.width, height: dimensions.height }
    return () => { bloomRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- particles created once, resized by draw loop
  }, [])

  // OTTO PATCH (see OTTO-PATCHES.md): keep the star field filling the pane on
  // resize. The field's extent is proportional to width/height (createDepth-
  // Particles spans [-w*0.5, w*1.5]; updateDepthParticles wraps against the
  // live w/h). Shrinking the pane makes width*1.5 tiny, so the wrap snaps every
  // star to -width*0.5 and the field collapses into a thin column on the edge —
  // and growing the pane back never un-collapses it (drift is far too slow).
  // Remapping x/y by the dimension ratio stretches the field with the pane, so
  // it stays evenly spread across whatever size the pane becomes.
  useEffect(() => {
    const prev = particleDimsRef.current
    const { width, height } = dimensions
    if (width <= 0 || height <= 0) return
    if (prev.width > 0 && prev.height > 0) {
      const sx = width / prev.width
      const sy = height / prev.height
      if (sx !== 1 || sy !== 1) {
        for (const p of depthParticlesRef.current) {
          p.x *= sx
          p.y *= sy
        }
      }
    }
    particleDimsRef.current = { width, height }
  }, [dimensions])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        const h = entry.contentRect.height
        setDimensions({ width: w, height: h })
        bloomRef.current?.resize(w * dpr, h * dpr)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // ─── Detect state changes → spawn effects ──────────────────────────────

  const detectStateChanges = useCallback(() => {
    const { agents, toolCalls } = drawPropsRef.current
    const { effects, newAgentStates, newToolStates } = detectStateChangesPure(
      agents, toolCalls,
      prevAgentStatesRef.current, prevToolStatesRef.current,
    )
    effectsRef.current.push(...effects)
    prevAgentStatesRef.current = newAgentStates
    prevToolStatesRef.current = newToolStates
  }, [])

  // ─── Main draw loop ────────────────────────────────────────────────────

  // Stable ref so the rAF loop always calls the latest draw without
  // re-subscribing when the callback identity changes.
  const drawRef = useRef<(timestamp: number) => void>(() => {})

  const draw = useCallback((timestamp: number) => {
    animationRef.current = requestAnimationFrame((ts) => drawRef.current(ts))

    const canvas = mainCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      // Sync simulation data from ref — always fresh, independent of React renders
      {
        const s = simulationRef.current
        const p = drawPropsRef.current
        p.agents = s.agents
        p.toolCalls = s.toolCalls
        p.particles = s.particles
        p.edges = s.edges
        p.discoveries = s.discoveries
        p.simTime = s.currentTime
      }

      const {
        agents, toolCalls, particles, edges, discoveries,
        selectedAgentId, hoveredAgentId, showStats,
        showCostOverlay, selectedToolCallId, selectedDiscoveryId,
        simTime, pauseAutoFit, dimensions, onAgentDrag,
        isDragging, renderOptions,
      } = drawPropsRef.current
      // OTTO PATCH: host-toggleable render layers (default all on) + node shape
      const showBloom = renderOptions?.bloom !== false
      const showNodeGlow = renderOptions?.nodeGlow !== false
      const showStars = renderOptions?.stars !== false
      const showBackdrop = renderOptions?.backdrop !== false
      const nodeShape = renderOptions?.nodeShape ?? 'hexagon'
      const contextDisplay = renderOptions?.contextDisplay ?? 'ring'
      const transform = transformRef.current

      const deltaTime = lastFrameTimeRef.current ? (timestamp - lastFrameTimeRef.current) / 1000 : ANIM_SPEED.defaultDeltaTime
      lastFrameTimeRef.current = timestamp
      timeRef.current += deltaTime
      if (simTime != null) simTimeRef.current = simTime

      const dpr = dprRef.current
      const w = dimensions.width
      const h = dimensions.height

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
      }

      // Camera physics (inertia + auto-fit)
      updateCamera(isDragging, pauseAutoFit)

      // Floaty agent drag
      updateDragLerp(agents, onAgentDrag)

      // Detect state changes → visual effects
      detectStateChanges()

      // Update effects (mutate in place to avoid GC pressure)
      {
        const effects = effectsRef.current
        let writeIdx = 0
        for (let i = 0; i < effects.length; i++) {
          effects[i].age += deltaTime
          if (effects[i].age < effects[i].duration) {
            if (writeIdx !== i) effects[writeIdx] = effects[i]
            writeIdx++
          }
        }
        effects.length = writeIdx
      }

      ctx.clearRect(0, 0, w, h)
      if (showStars) updateDepthParticles(depthParticlesRef.current, deltaTime, w, h)

      let activeAgentPos: { x: number; y: number; color: string } | undefined
      for (const [, agent] of agents) {
        if (agent.state === 'thinking' || agent.state === 'tool_calling' || agent.state === 'waiting_permission') {
          activeAgentPos = { x: agent.x, y: agent.y, color: getStateColor(agent.state) }
          break
        }
      }

      drawBackground(ctx, w, h, showStars ? depthParticlesRef.current : [], transform, timeRef.current, activeAgentPos, showBackdrop)

      ctx.save()
      ctx.translate(transform.x, transform.y)
      ctx.scale(transform.scale, transform.scale)

      // Pre-compute shared lookup structures — cached across frames when inputs are unchanged
      const elCache = edgeLookupCacheRef.current
      let activeEdgeIds: Set<string>
      let edgeMap: Map<string, Edge>
      if (elCache.particles === particles && elCache.edges === edges) {
        activeEdgeIds = elCache.activeEdgeIds
        edgeMap = elCache.edgeMap
      } else {
        activeEdgeIds = getActiveEdgeIds(particles)
        edgeMap = buildEdgeMap(edges)
        edgeLookupCacheRef.current = { particles, edges, activeEdgeIds, edgeMap }
      }

      drawDiscoveryConnections(ctx, discoveries, agents)
      drawEdges(ctx, edges, agents, toolCalls, activeEdgeIds, timeRef.current)
      drawToolCalls(ctx, toolCalls, timeRef.current, selectedToolCallId)
      drawDiscoveries(ctx, discoveries, agents, selectedDiscoveryId)
      drawAgents(ctx, agents, selectedAgentId, hoveredAgentId, showStats, timeRef.current, nodeShape, showNodeGlow, contextDisplay)
      drawMessageBubblesWorld(ctx, agents, simTimeRef.current)
      if (showCostOverlay) drawCostLabels(ctx, agents, toolCalls, showStats)
      drawParticles(ctx, particles, edgeMap, agents, toolCalls, timeRef.current)
      drawEffects(ctx, effectsRef.current, nodeShape)

      if (selectedAgentId) {
        const agent = agents.get(selectedAgentId)
        if (agent) drawTetherLine(ctx, agent, transform, w, h)
      }

      ctx.restore()

      // OTTO PATCH (OTTO-PATCHES.md): the cost summary panel moved to the DOM
      // (cost-panel.tsx) to match the Files panel; only the on-node cost pills
      // (drawCostLabels, above) still draw on the canvas.
      if (showBloom && bloomRef.current) bloomRef.current.apply(canvas, ctx)

      // ─── Performance overlay (enabled via ?perf or ?stress) ──────────
      if (PERF_OVERLAY_ENABLED) {
        const perf = perfRef.current
        const frameEnd = performance.now()
        const frameMs = frameEnd - (timestamp || frameEnd)
        perf.frameTimes.push(frameMs)
        if (perf.frameTimes.length > PERF_OVERLAY.maxFrameSamples) perf.frameTimes.shift()
        perf.frames++
        perf.frameTimeMs = frameMs
        if (frameEnd - perf.lastFpsUpdate >= PERF_OVERLAY.updateIntervalMs) {
          perf.fps = perf.frames
          perf.frames = 0
          perf.lastFpsUpdate = frameEnd
          const sorted = [...perf.frameTimes].sort((a, b) => a - b)
          perf.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
        }
        const po = PERF_OVERLAY
        const textX = po.x + po.padding
        let textY = po.y + po.lineHeight + 2
        ctx.save()
        ctx.fillStyle = po.bgColor
        ctx.fillRect(po.x, po.y, po.width, po.height)
        ctx.font = po.font
        ctx.fillStyle = perf.fps < po.fpsWarning ? po.fpsWarningColor : perf.fps < po.fpsCaution ? po.fpsCautionColor : po.fpsGoodColor
        ctx.fillText(`FPS: ${perf.fps}`, textX, textY); textY += po.lineHeight
        ctx.fillStyle = po.textColor
        ctx.fillText(`Frame: ${frameMs.toFixed(1)}ms  P95: ${perf.p95.toFixed(1)}ms`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Agents: ${agents.size}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Tool calls: ${toolCalls.size}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Particles: ${particles.length}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Edges: ${edges.length}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Discoveries: ${discoveries.length}`, textX, textY)
        ctx.restore()
      }

    } catch (err) {
      // Log at most once every 5s to avoid flooding the console
      const now = Date.now()
      if (now - lastDrawErrorRef.current > 5000) {
        lastDrawErrorRef.current = now
        console.warn('[AgentCanvas] draw error:', err)
      }
    }
  }, [detectStateChanges, updateCamera, updateDragLerp, transformRef])

  drawRef.current = draw

  useEffect(() => {
    const loop = (timestamp: number) => drawRef.current(timestamp)
    animationRef.current = requestAnimationFrame(loop)
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- drawRef is stable; rAF loop set up once
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
      <canvas
        ref={mainCanvasRef}
        style={{ width: dimensions.width, height: dimensions.height }}
        {...handlers}
        className="w-full h-full"
      />
    </div>
  )
}
