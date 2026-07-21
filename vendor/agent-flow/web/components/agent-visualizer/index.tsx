"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { AgentCanvas } from "./canvas"
import { ControlBar } from "./control-bar"
import { AgentDetailCard } from "./agent-detail-card"
// OTTO PATCH (OTTO-PATCHES.md): GlassContextMenu removed — the right-click menu's
// actions moved to the native Otto toolbar, so the menu is no longer rendered.
import { ToolDetailPopup } from "./tool-detail-popup"
import { DiscoveryDetailPopup } from "./discovery-detail-popup"
import { FileAttentionPanel } from "./file-attention-panel"
import { CostPanel } from "./cost-panel"
import { TimelinePanel } from "./timeline-panel"
import { OpenFileProvider } from "./tool-content-renderer"
import { stopPropagationHandlers } from "./shared-ui"
import { TimelineEvent, TIMING } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"

import { MOCK_DURATION } from "@/lib/mock-scenario"
import { TopBar } from "./top-bar"
import { FpsMeter } from "./fps-meter"
import { useAudioEffects } from "@/hooks/use-audio-effects"

export function AgentVisualizer() {
  const bridge = useVSCodeBridge()

  // OTTO PATCH (OTTO-PATCHES.md): set by the simulation on a frame that settled
  // hydrate-flagged (backfilled) events; read-and-cleared by useAudioEffects to
  // mute the spawn/tool sounds a bring-into-view replay would otherwise fire.
  const suppressAudioRef = useRef(false)

  const {
    frameRef,
    agents,
    toolCalls,
    particles,
    edges,
    discoveries,
    fileAttention,
    timelineEntries,
    currentTime,
    isPlaying,
    speed,
    maxTimeReached,
    retiredTokens,
    conversations,
    play,
    pause,
    restart,
    setSpeed,
    seekToTime,
    updateAgentPosition,
    saveSnapshot,
    restoreSnapshot,
  } = useAgentSimulation({
    useMockData: bridge.useMockData,
    externalEvents: bridge.pendingEvents,
    onExternalEventsConsumed: bridge.consumeEvents,
    sessionFilter: bridge.selectedSessionId,
    // Pass the ref that's updated synchronously in session-started handler,
    // so the animation frame never uses a stale filter value.
    sessionFilterRef: bridge.selectedSessionIdRef,
    disable1MContext: bridge.disable1MContext,
    // OTTO PATCH: the animate loop raises this when it settles a hydrate batch
    // so useAudioEffects can mute that frame's spawn/tool sounds.
    suppressAudioRef,
  })

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  const [showStats, setShowStats] = useState(false)
  const [showCostOverlay, setShowCostOverlay] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showFileAttention, setShowFileAttention] = useState(false)

  // Otto patch (OTTO-PATCHES.md): whole-HUD visibility. When true, every HUD
  // panel/bar/popup is hidden and only the canvas graph plus the HUD toggle
  // button (bottom-left) remain. Seeded/overridden by the host's authoritative
  // `config.hudHidden` on every config that carries it (mirrors the panels
  // seed), and reported back on the in-page toggle so it persists across every
  // Visualizer tab.
  // OTTO PATCH: the show/hide-HUD "eye" now lives in the native Otto toolbar
  // (it drives the device-local visualizerHudHidden setting → config.hudHidden),
  // so this state is purely config-driven — no in-page toggle button anymore.
  const [hudHidden, setHudHidden] = useState(false)
  useEffect(() => {
    if (bridge.hudHidden != null) setHudHidden(bridge.hudHidden)
  }, [bridge.hudHidden])

  // OTTO PATCH (OTTO-PATCHES.md): hide ONLY the bottom control bar, keeping the
  // top stats bar. `hudHidden` is all-or-nothing, but Otto's PIP mode wants the
  // top HUD and no controls at all (it is a glanceable viewport, not an
  // interactive surface), so the two halves need independent gates. Purely
  // config-driven, same shape as hudHidden; `hudHidden` still wins over both.
  const [hudBottomHidden, setHudBottomHidden] = useState(false)
  useEffect(() => {
    if (bridge.hudBottomHidden != null) setHudBottomHidden(bridge.hudBottomHidden)
  }, [bridge.hudBottomHidden])

  // OTTO PATCH (OTTO-PATCHES.md): compact ("mini") HUD layout — Otto's PIP.
  // Not a third visibility gate: the same HUD pieces render, they just get
  // arranged for a ~240x150 viewport (stats split across both top corners, FPS
  // meter down to the bottom-left).
  const [hudCompact, setHudCompact] = useState(false)
  useEffect(() => {
    if (bridge.hudCompact != null) setHudCompact(bridge.hudCompact)
  }, [bridge.hudCompact])

  // Mutually exclusive panel toggling — opening one closes the others.
  // OTTO PATCH (OTTO-PATCHES.md): the transcript ("Chat") panel was removed
  // from Otto's embed, so the exclusive group is just files/cost now.
  const toggleExclusivePanel = useCallback((panel: 'files' | 'cost') => {
    setShowFileAttention(prev => panel === 'files' ? !prev : false)
    setShowCostOverlay(prev => panel === 'cost' ? !prev : false)
  }, [])

  // Otto patch (OTTO-PATCHES.md): apply a host-seeded initial panel config
  // (bridge `config.panels`) on every message that carries one — not just the
  // first, matching how showMockData/disable1MContext behave. The mutually
  // exclusive trio (files/transcript/cost) is resolved by priority — a config
  // that sets more than one true keeps only the highest-priority one — rather
  // than briefly rendering an invalid multi-panel state.
  useEffect(() => {
    const panels = bridge.panelsConfig
    if (!panels) return
    // OTTO PATCH (OTTO-PATCHES.md): the "Toggle Stats" toolbar button is a
    // config-driven follower like the other panels — seeded from the host's
    // visualizerPanelStats setting on every config that carries it.
    if (panels.stats !== undefined) setShowStats(panels.stats)
    if (panels.timeline !== undefined) setShowTimeline(panels.timeline)
    // OTTO PATCH (OTTO-PATCHES.md): the transcript ("Chat") and message-feed
    // panels were removed from Otto's embed, so only the files/cost exclusive
    // pair is seeded here.
    if (panels.fileAttention || panels.costOverlay) {
      setShowFileAttention(Boolean(panels.fileAttention))
      setShowCostOverlay(!panels.fileAttention && Boolean(panels.costOverlay))
    } else if (
      panels.fileAttention !== undefined ||
      panels.costOverlay !== undefined
    ) {
      setShowFileAttention(false)
      setShowCostOverlay(false)
    }
  }, [bridge.panelsConfig])

  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0)

  const [isReviewing, setIsReviewing] = useState(false)
  // `isMuted` (the mute display state) is intentionally not read here anymore —
  // the mute toggle moved to the native Otto toolbar; the page's audio stays
  // config-driven (config.soundVolume). handleToggleMute is still wired to the
  // keyboard shortcut.
  const { seekingRef, handleToggleMute } = useAudioEffects(agents, toolCalls, isReviewing, bridge.soundVolume, bridge.bridgeSetSoundMuted, suppressAudioRef)

  // Auto-play on mount
  useEffect(() => {
    const timer = setTimeout(() => play(), TIMING.autoPlayDelayMs)
    return () => clearTimeout(timer)
  }, [play])

  // Per-session state cache: save/restore simulation state on tab switch
  // so sessions stay up to date and switching is instant.
  // useLayoutEffect ensures restart happens synchronously before any animation
  // frame can consume and discard events from pendingEventsRef.
  const sessionCacheRef = useRef<Map<string, { snapshot: ReturnType<typeof saveSnapshot>; eventCount: number }>>(new Map())
  const prevSelectedRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (bridge.selectedSessionId && bridge.selectedSessionId !== prevSelectedRef.current) {
      // Save outgoing session state (if any)
      if (prevSelectedRef.current !== null) {
        sessionCacheRef.current.set(prevSelectedRef.current, {
          snapshot: saveSnapshot(),
          eventCount: bridge.getSessionEventCount(prevSelectedRef.current),
        })
      }

      // Restore or cold-start the incoming session, then flush events.
      // Flushing happens HERE (after state swap) to prevent the animation
      // frame from processing events in the wrong simulation context.
      const cached = sessionCacheRef.current.get(bridge.selectedSessionId)
      if (cached) {
        restoreSnapshot(cached.snapshot)
        bridge.flushSessionEvents(bridge.selectedSessionId, cached.eventCount)
      } else {
        restart()
        bridge.flushSessionEvents(bridge.selectedSessionId)
      }

      prevSelectedRef.current = bridge.selectedSessionId
    } else if (bridge.selectedSessionId === null && prevSelectedRef.current !== null) {
      // OTTO PATCH (OTTO-PATCHES.md): the last session was closed (e.g. the
      // visualized chat was archived, so the host sent close-session and no
      // session remains to auto-select). Cold-restart the simulation so the
      // canvas empties and the "Waiting for chat activity" empty state shows,
      // instead of leaving the final agent frozen in the center.
      restart()
      prevSelectedRef.current = null
    }
  }, [bridge.selectedSessionId, restart, bridge.flushSessionEvents, saveSnapshot, restoreSnapshot, bridge.getSessionEventCount])

  // Timeline events — incremental: only processes new conversation messages
  const timelineCacheRef = useRef<{
    counts: Map<string, number>
    events: TimelineEvent[]
    idCounter: number
  }>({ counts: new Map(), events: [], idCounter: 0 })

  const timelineEvents = useMemo((): TimelineEvent[] => {
    const cache = timelineCacheRef.current
    let appended = false
    for (const [agentId, msgs] of conversations) {
      const prevLen = cache.counts.get(agentId) ?? 0
      if (msgs.length > prevLen) {
        for (let i = prevLen; i < msgs.length; i++) {
          const msg = msgs[i]
          cache.events.push({
            id: `event-${cache.idCounter++}`,
            type: msg.type === 'tool_call' ? 'tool_call' : msg.type === 'tool_result' ? 'tool_result' : 'message',
            label: msg.content.slice(0, 20),
            timestamp: msg.timestamp,
            nodeId: agentId,
          })
        }
        cache.counts.set(agentId, msgs.length)
        appended = true
      }
    }
    if (appended) cache.events.sort((a, b) => a.timestamp - b.timestamp)
    return cache.events
  }, [conversations])

  // Review mode: when in live mode and user pauses to scrub through history

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
      setIsReviewing(true)
    } else {
      // OTTO PATCH (OTTO-PATCHES.md): "replay from the start when play is hit at
      // the end." After the host's attach/hydrate the sim clock rests at
      // maxTimeReached (the settled present), so a bare play() resumes past the
      // last event and nothing visibly replays — the button just toggles. Match
      // standard media-player behavior: playing from (or past) the end restarts
      // the replay from the beginning; a user who scrubbed to the middle first
      // still resumes from there. (maxTimeReached > 0 guards the empty/degenerate
      // case where there is nothing to replay.)
      if (maxTimeReached > 0 && currentTime >= maxTimeReached - 0.05) {
        seekToTime(0)
      }
      play()
    }
  }, [isPlaying, play, pause, currentTime, maxTimeReached, seekToTime])

  const handleEnterReview = useCallback(() => {
    pause()
    setIsReviewing(true)
  }, [pause])

  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResumeLive = useCallback(() => {
    setIsReviewing(false)
    seekToTime(maxTimeReached)
    setZoomToFitTrigger(n => n + 1)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { resumeTimerRef.current = null; play() }, TIMING.resumeLiveDelayMs)
  }, [seekToTime, maxTimeReached, play])
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  const handleRestart = useCallback(() => {
    setIsReviewing(false)
    restart(true)
  }, [restart])

  // Keyboard shortcuts
  // OTTO PATCH (OTTO-PATCHES.md): when a bridge host is attached, panel
  // visibility is host-owned — the host's settings seed `config.panels`, and
  // this component follows them (the seed effect above). A keyboard toggle
  // that flipped page-LOCAL state desynced the host's toolbar buttons and got
  // snapped back closed by the very next config push. So with a host attached
  // the shortcuts forward a `panel-toggle` request (the host flips its setting
  // and the change round-trips via config.panels); the local flip remains only
  // as the standalone/demo fallback where no host exists.
  const { bridgeTogglePanel, isVSCode: hasBridgeHost } = bridge
  const keyboardActions = useMemo(() => ({
    togglePlayPause: handlePlayPause,
    toggleFilePanel: () => {
      if (hasBridgeHost) bridgeTogglePanel('files')
      else toggleExclusivePanel('files')
    },
    toggleTimeline: () => {
      if (hasBridgeHost) bridgeTogglePanel('timeline')
      else setShowTimeline(prev => !prev)
    },
    toggleStats: () => {
      if (hasBridgeHost) bridgeTogglePanel('stats')
      else setShowStats(prev => !prev)
    },
    toggleCostOverlay: () => {
      if (hasBridgeHost) bridgeTogglePanel('cost')
      else toggleExclusivePanel('cost')
    },
    zoomToFit: () => { setZoomToFitTrigger(n => n + 1) },
    clearSelection: () => { selection.clearAllSelections() },
    deselectAgent: () => { selection.clearAgent() },
    toggleMute: handleToggleMute,
    setSpeed,
    selectedAgentId: selection.selectedAgentId,
  }), [handlePlayPause, selection.clearAllSelections, selection.clearAgent, selection.selectedAgentId, setSpeed, handleToggleMute, toggleExclusivePanel, hasBridgeHost, bridgeTogglePanel])

  useKeyboardShortcuts(keyboardActions)

  // OTTO PATCH (OTTO-PATCHES.md): honest total — prefer each agent's lifetime
  // cumulativeTokens over context occupancy, and keep counting agents whose
  // completed nodes were already cleaned up (retiredTokens).
  const totalTokens = useMemo(() => {
    let sum = retiredTokens ?? 0
    for (const a of agents.values()) sum += a.cumulativeTokens ?? a.tokensUsed
    return sum
  }, [agents, retiredTokens])

  const selectedAgent = selection.selectedAgentId ? agents.get(selection.selectedAgentId) : null

  // OTTO PATCH (OTTO-PATCHES.md): the in-canvas right-click context menu was
  // removed — every one of its actions (Zoom to Fit / Toggle Stats / Restart)
  // now lives in the native Otto toolbar above the tab, so the menu had
  // nothing left to offer. Right-click is a no-op that still swallows the
  // browser's native menu (use-canvas-interaction's preventDefault); the
  // canvas's onContextMenu prop is simply not passed anymore.

  const handleCloseSession = useCallback((id: string) => {
    bridge.removeSession(id)
    sessionCacheRef.current.delete(id)
    if (bridge.selectedSessionId === id) {
      const remaining = bridge.sessions.filter(s => s.id !== id)
      if (remaining.length > 0) {
        bridge.selectSession(remaining[remaining.length - 1].id)
      } else {
        // OTTO PATCH (OTTO-PATCHES.md): no session left — clear selection so the
        // useLayoutEffect above cold-restarts the simulation and the canvas
        // returns to the "Waiting for chat activity" empty state. Without this
        // the last agent stayed frozen in the center after archiving the chat.
        bridge.selectSession(null)
      }
    }
  }, [bridge])

  // OTTO PATCH (OTTO-PATCHES.md): mirror the live session list/selection/activity
  // to the host so the Otto toolbar's chats dropdown can render + drive them.
  // The session TABS themselves were removed from the HUD — the toolbar owns the
  // switcher now. No loop: a host select command changes selection → one report
  // → the host mirror updates; the host doesn't re-emit on that.
  const { bridgeReportSessionState, subscribeSessionCommand } = bridge
  useEffect(() => {
    bridgeReportSessionState({
      sessions: bridge.sessions.map(s => ({ id: s.id, label: s.label, status: s.status })),
      selectedId: bridge.selectedSessionId,
      activityIds: [...bridge.sessionsWithActivity],
    })
  }, [bridgeReportSessionState, bridge.sessions, bridge.selectedSessionId, bridge.sessionsWithActivity])

  // OTTO PATCH: run the Otto toolbar's chats-dropdown commands through the same
  // paths a HUD tab click used — select flows through selectSession (+ the
  // useLayoutEffect save/restore/flush above); close reuses handleCloseSession.
  useEffect(() => {
    return subscribeSessionCommand((command, sessionId) => {
      if (command === 'select') bridge.selectSession(sessionId)
      else handleCloseSession(sessionId)
    })
  }, [subscribeSessionCommand, bridge, handleCloseSession])

  // OTTO PATCH (OTTO-PATCHES.md): run the Otto toolbar's viewport commands
  // (Zoom to Fit / Restart) — the imperative counterparts of the panel toggles.
  // These used to live in the in-canvas right-click context menu, which was
  // removed once every one of its actions had a home in the toolbar.
  const { subscribeViewportCommand } = bridge
  useEffect(() => {
    return subscribeViewportCommand((command) => {
      if (command === 'zoom-to-fit') setZoomToFitTrigger(n => n + 1)
      else handleRestart()
    })
  }, [subscribeViewportCommand, handleRestart])

  const openFile = useCallback((filePath: string, line?: number) => {
    bridge.bridgeOpenFile(filePath, line)
  }, [bridge])

  const isEmpty = agents.size === 0 && !bridge.useMockData

  return (
    <OpenFileProvider value={bridge.isVSCode ? openFile : null}>
    <div className="h-screen w-screen relative overflow-hidden" style={{ background: COLORS.void }}>
      {/* Empty state when no demo and no live data */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center font-mono">
            <div className="text-sm" style={{ color: COLORS.holoBase + '80' }}>Waiting for chat activity</div>
            <div className="mt-2 text-xs" style={{ color: COLORS.holoBase + '40' }}>Create a new agent chat to visualize</div>
          </div>
        </div>
      )}

      {/* Canvas fills everything */}
      <AgentCanvas
        simulationRef={frameRef}
        selectedAgentId={selection.selectedAgentId}
        hoveredAgentId={selection.hoveredAgentId}
        showStats={showStats}
        zoomToFitTrigger={zoomToFitTrigger}
        onAgentClick={selection.handleAgentClick}
        onAgentHover={selection.setHoveredAgentId}
        onAgentDrag={updateAgentPosition}
        onToolCallClick={selection.handleToolCallClick}
        selectedToolCallId={selection.selectedToolCallId}
        onDiscoveryClick={selection.handleDiscoveryClick}
        selectedDiscoveryId={selection.selectedDiscoveryId}
        showCostOverlay={showCostOverlay}
        renderOptions={bridge.renderConfig ?? undefined}
        cameraFraming={bridge.cameraConfig ?? undefined}
      />

      {/* Otto patch (OTTO-PATCHES.md): the HUD chrome — top bar + control bar —
          collapses behind a single visibility toggle. Informational surfaces
          (node/tool/discovery popups, chat panel, slide-in panels) stay
          visible: hiding the HUD means clearing the chrome, not blinding the
          user. */}
      {/* OTTO PATCH (OTTO-PATCHES.md): the top-left message-feed panel was
          removed from Otto's embed — it duplicated the real chat transcript
          the user already has. */}

      {/* Agent detail card (floating, tethered to node) */}
      {selectedAgent && selection.selectedAgentWorldPos && (
        <div {...stopPropagationHandlers}>
          <AgentDetailCard
            agent={selectedAgent}
            onClose={selection.clearAgent}
          />
        </div>
      )}

      {/* Tool call detail popup */}
      {selection.selectedToolData && selection.selectedToolScreenPos && (
        <div {...stopPropagationHandlers}>
          <ToolDetailPopup
            tool={selection.selectedToolData}
            position={selection.selectedToolScreenPos}
            onClose={selection.clearTool}
          />
        </div>
      )}

      {/* Discovery detail popup */}
      {selection.selectedDiscoveryData && selection.selectedDiscoveryScreenPos && (
        <div {...stopPropagationHandlers}>
          <DiscoveryDetailPopup
            discovery={selection.selectedDiscoveryData}
            position={selection.selectedDiscoveryScreenPos}
            onClose={selection.clearDiscovery}
          />
        </div>
      )}

      {/* OTTO PATCH (OTTO-PATCHES.md): the per-node chat panel (bottom-right,
          click a node → that agent's messages) was removed — it duplicated the
          real chat transcript the user already has open, same rationale as the
          Chat/message-feed panels. Only the node detail card remains on click. */}

      {/* OTTO PATCH (OTTO-PATCHES.md): the right-click GlassContextMenu was
          removed — its actions moved to the native Otto toolbar. */}

      {/* Floating control strip */}
      {!hudHidden && !hudBottomHidden && (
      <ControlBar
        isPlaying={isPlaying}
        speed={speed}
        currentTime={currentTime}
        totalDuration={bridge.useMockData
          ? (isReviewing ? Math.max(maxTimeReached, currentTime) : MOCK_DURATION)
          : Math.max(maxTimeReached, currentTime)
        }
        onPlayPause={handlePlayPause}
        onRestart={handleRestart}
        onSpeedChange={setSpeed}
        onSeek={(time) => {
          seekingRef.current = true
          pause()
          seekToTime(time)
          setZoomToFitTrigger(n => n + 1)
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = setTimeout(() => { resumeTimerRef.current = null; seekingRef.current = false }, TIMING.seekCompleteDelayMs)
        }}
        timelineEvents={timelineEvents}
        isReviewing={isReviewing}
        eventCount={timelineEvents.length}
        onEnterReview={handleEnterReview}
        onResumeLive={handleResumeLive}
      />
      )}

      {/* File attention panel (slide-in from right). OTTO PATCH: closed by the
          Files toolbar toggle, so no onClose ✕. */}
      <FileAttentionPanel
        visible={showFileAttention}
        fileAttention={fileAttention}
        onOpenFile={bridge.isVSCode ? openFile : undefined}
      />

      {/* Cost panel (slide-in from right, same top-right anchor as Files —
          they're mutually exclusive). OTTO PATCH (OTTO-PATCHES.md): a DOM
          re-implementation of the former canvas cost summary panel. */}
      <CostPanel
        visible={showCostOverlay}
        agents={agents}
        toolCalls={toolCalls}
      />

      {/* OTTO PATCH (OTTO-PATCHES.md): the session transcript ("Chat") panel
          was removed from Otto's embed — it duplicated the real chat the user
          already has open. */}

      {/* Timeline panel (slide-in from bottom). OTTO PATCH: closed by the
          Timeline toolbar toggle, so no onClose ✕. */}
      <TimelinePanel
        visible={showTimeline}
        timelineEntries={timelineEntries}
        currentTime={currentTime}
      />

      {/* Top bar: stats readout only. OTTO PATCH (OTTO-PATCHES.md): the
          session-tab column and every control button (Files/Cost/Audio/eye and
          the Timeline toggle) were pulled OUT into the native Otto toolbar above
          the tab; only the stats readout remains in the HUD. */}
      {!hudHidden && (
        <TopBar agentCount={agents.size} totalTokens={totalTokens} compact={hudCompact} />
      )}

      {/* OTTO PATCH (OTTO-PATCHES.md): host-toggleable FPS meter
          (config.render.showFps), pinned bottom-right. Independent of the HUD
          visibility toggle — it's a perf diagnostic, useful even in clean view. */}
      {bridge.renderConfig?.showFps && <FpsMeter compact={hudCompact} />}
    </div>
    </OpenFileProvider>
  )
}
