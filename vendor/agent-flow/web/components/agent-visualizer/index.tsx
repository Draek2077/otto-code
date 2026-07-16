"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { AgentCanvas } from "./canvas"
import { ControlBar } from "./control-bar"
import { AgentDetailCard } from "./agent-detail-card"
import { GlassContextMenu } from "./glass-context-menu"
import { ToolDetailPopup } from "./tool-detail-popup"
import { DiscoveryDetailPopup } from "./discovery-detail-popup"
import { FileAttentionPanel } from "./file-attention-panel"
import { TimelinePanel } from "./timeline-panel"
import { AgentChatPanel } from "./chat-panel"
import { SessionTranscriptPanel } from "./session-transcript-panel"
import { OpenFileProvider } from "./tool-content-renderer"
import { stopPropagationHandlers } from "./shared-ui"
import { TimelineEvent, TIMING, Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"

import { MOCK_DURATION } from "@/lib/mock-scenario"
import { MessageFeedPanel } from "./message-feed-panel"
import { TopBar } from "./top-bar"
import { useAudioEffects } from "@/hooks/use-audio-effects"

export function AgentVisualizer() {
  const bridge = useVSCodeBridge()

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
  })

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  const [showStats, setShowStats] = useState(false)
  const [showHexGrid, setShowHexGrid] = useState(true)
  const [showCostOverlay, setShowCostOverlay] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showFileAttention, setShowFileAttention] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showMessageFeed, setShowMessageFeed] = useState(true)

  // Otto patch (OTTO-PATCHES.md): whole-HUD visibility. When true, every HUD
  // panel/bar/popup is hidden and only the canvas graph plus the HUD toggle
  // button (bottom-left) remain. Seeded/overridden by the host's authoritative
  // `config.hudHidden` on every config that carries it (mirrors the panels
  // seed), and reported back on the in-page toggle so it persists across every
  // Visualizer tab.
  const [hudHidden, setHudHidden] = useState(false)
  useEffect(() => {
    if (bridge.hudHidden != null) setHudHidden(bridge.hudHidden)
  }, [bridge.hudHidden])
  const handleToggleHud = useCallback(() => {
    setHudHidden(prev => {
      const next = !prev
      bridge.bridgeSetHudHidden(next)
      return next
    })
  }, [bridge.bridgeSetHudHidden])

  // Mutually exclusive panel toggling — opening one closes the others
  const toggleExclusivePanel = useCallback((panel: 'files' | 'transcript' | 'cost') => {
    setShowFileAttention(prev => panel === 'files' ? !prev : false)
    setShowTranscript(prev => panel === 'transcript' ? !prev : false)
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
    if (panels.hexGrid !== undefined) setShowHexGrid(panels.hexGrid)
    if (panels.timeline !== undefined) setShowTimeline(panels.timeline)
    if (panels.messageFeed !== undefined) setShowMessageFeed(panels.messageFeed)
    if (panels.fileAttention || panels.transcript || panels.costOverlay) {
      setShowFileAttention(Boolean(panels.fileAttention))
      setShowTranscript(!panels.fileAttention && Boolean(panels.transcript))
      setShowCostOverlay(!panels.fileAttention && !panels.transcript && Boolean(panels.costOverlay))
    } else if (
      panels.fileAttention !== undefined ||
      panels.transcript !== undefined ||
      panels.costOverlay !== undefined
    ) {
      setShowFileAttention(false)
      setShowTranscript(false)
      setShowCostOverlay(false)
    }
  }, [bridge.panelsConfig])

  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0)

  const [isReviewing, setIsReviewing] = useState(false)
  const { isMuted, seekingRef, handleToggleMute } = useAudioEffects(agents, toolCalls, isReviewing, bridge.soundVolume, bridge.bridgeSetSoundMuted)

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
      play()
    }
  }, [isPlaying, play, pause])

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
  const keyboardActions = useMemo(() => ({
    togglePlayPause: handlePlayPause,
    toggleFilePanel: () => toggleExclusivePanel('files'),
    toggleTranscript: () => toggleExclusivePanel('transcript'),
    toggleTimeline: () => { setShowTimeline(prev => !prev) },
    toggleHexGrid: () => { setShowHexGrid(prev => !prev) },
    toggleStats: () => { setShowStats(prev => !prev) },
    toggleCostOverlay: () => toggleExclusivePanel('cost'),
    zoomToFit: () => { setZoomToFitTrigger(n => n + 1) },
    clearSelection: () => { selection.clearAllSelections() },
    deselectAgent: () => { selection.clearAgent() },
    closeTranscript: () => { setShowTranscript(false) },
    toggleMute: handleToggleMute,
    setSpeed,
    selectedAgentId: selection.selectedAgentId,
  }), [handlePlayPause, selection.clearAllSelections, selection.clearAgent, selection.selectedAgentId, setSpeed, handleToggleMute, toggleExclusivePanel])

  useKeyboardShortcuts(keyboardActions)

  const totalTokens = useMemo(() => {
    let sum = 0
    for (const a of agents.values()) sum += a.tokensUsed
    return sum
  }, [agents])

  const selectedAgent = selection.selectedAgentId ? agents.get(selection.selectedAgentId) : null
  const selectedConversation = selection.selectedAgentId ? (conversations.get(selection.selectedAgentId) || []) : []

  // Session runtime — drives the assistant label (CLAUDE vs CODEX) in transcript panels
  const sessionRuntime = useMemo(() => {
    for (const a of agents.values()) {
      if (a.runtime === 'codex') return 'codex' as const
    }
    return 'claude' as const
  }, [agents])

  // Session-wide conversation (all agents merged chronologically)
  // Only compute when the transcript panel is visible to avoid O(n log n) sort every frame
  const sessionConversation = useMemo(() => {
    if (!showTranscript) return []
    const all = Array.from(conversations.values()).flat()
    return all.sort((a, b) => a.timestamp - b.timestamp)
  }, [conversations, showTranscript])

  // Context menu items
  const contextMenuItems = selection.contextMenu ? (
    selection.contextMenu.agentId ? [
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
    ] : [
      { label: '🔍  Zoom to Fit', onClick: () => setZoomToFitTrigger(n => n + 1) },
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
      { label: '⬡  Toggle Grid', onClick: () => setShowHexGrid(prev => !prev) },
      { label: '', onClick: () => {}, separator: true },
      { label: '⟲  Restart', onClick: restart },
    ]
  ) : []

  const handleCloseSession = useCallback((id: string) => {
    bridge.removeSession(id)
    sessionCacheRef.current.delete(id)
    if (bridge.selectedSessionId === id) {
      const remaining = bridge.sessions.filter(s => s.id !== id)
      if (remaining.length > 0) {
        bridge.selectSession(remaining[remaining.length - 1].id)
      }
    }
  }, [bridge])

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
        showHexGrid={showHexGrid}
        zoomToFitTrigger={zoomToFitTrigger}
        pauseAutoFit={selection.contextMenu !== null}
        onAgentClick={selection.handleAgentClick}
        onAgentHover={selection.setHoveredAgentId}
        onAgentDrag={updateAgentPosition}
        onContextMenu={selection.handleContextMenu}
        onToolCallClick={selection.handleToolCallClick}
        selectedToolCallId={selection.selectedToolCallId}
        onDiscoveryClick={selection.handleDiscoveryClick}
        selectedDiscoveryId={selection.selectedDiscoveryId}
        showCostOverlay={showCostOverlay}
        renderOptions={bridge.renderConfig ?? undefined}
      />

      {/* Otto patch (OTTO-PATCHES.md): the entire HUD — every panel, bar, and
          floating popup — collapses behind a single visibility toggle. Only the
          canvas (above) and the toggle button (below) survive when hidden. */}
      {!hudHidden && (
      <>
      {/* Message feed panel (top-left) */}
      {showMessageFeed && (
        <MessageFeedPanel
          conversations={conversations}
          agents={agents}
          onAgentClick={selection.handleAgentClick}
          selectedAgentId={selection.selectedAgentId}
        />
      )}

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

      {/* Chat panel (bottom-right, shown when agent selected) */}
      <AgentChatPanel
        visible={!!selectedAgent}
        agentName={selectedAgent?.name ?? ''}
        agentState={selectedAgent?.state ?? 'idle'}
        conversation={selectedConversation}
        runtime={selectedAgent?.runtime ?? sessionRuntime}
        onClose={selection.clearAgent}
      />

      {/* Context menu */}
      {selection.contextMenu && (
        <GlassContextMenu
          position={selection.contextMenu}
          items={contextMenuItems}
          onClose={() => selection.setContextMenu(null)}
        />
      )}

      {/* Floating control strip */}
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

      {/* File attention panel (slide-in from right) */}
      <FileAttentionPanel
        visible={showFileAttention}
        fileAttention={fileAttention}
        onClose={() => setShowFileAttention(false)}
        onOpenFile={bridge.isVSCode ? openFile : undefined}
      />

      {/* Session transcript panel (slide-in from right) */}
      <SessionTranscriptPanel
        visible={showTranscript}
        conversation={sessionConversation}
        runtime={sessionRuntime}
        onClose={() => setShowTranscript(false)}
      />

      {/* Timeline panel (slide-in from bottom) */}
      <TimelinePanel
        visible={showTimeline}
        timelineEntries={timelineEntries}
        currentTime={currentTime}
        onClose={() => setShowTimeline(false)}
      />

      {/* Top bar: session tabs + info/controls */}
      <TopBar
        sessions={bridge.sessions}
        selectedSessionId={bridge.selectedSessionId}
        sessionsWithActivity={bridge.sessionsWithActivity}
        onSelectSession={bridge.selectSession}
        onCloseSession={handleCloseSession}
        isVSCode={bridge.isVSCode}
        connectionStatus={bridge.connectionStatus}
        agentCount={agents.size}
        totalTokens={totalTokens}
        showFileAttention={showFileAttention}
        showTranscript={showTranscript}
        showCostOverlay={showCostOverlay}
        showTimeline={showTimeline}
        isMuted={isMuted}
        onTogglePanel={toggleExclusivePanel}
        onToggleTimeline={() => setShowTimeline(prev => !prev)}
        onToggleMute={handleToggleMute}
      />
      </>
      )}

      {/* Otto patch (OTTO-PATCHES.md): HUD visibility toggle — the one control
          that stays put when the HUD is hidden. Bottom-left, clear of the
          control strip (bottom-center) and message feed (top-left). */}
      <button
        onClick={handleToggleHud}
        title={hudHidden ? 'Show HUD' : 'Hide HUD'}
        aria-label={hudHidden ? 'Show HUD' : 'Hide HUD'}
        className="absolute bottom-3 left-3 p-1.5 rounded transition-all"
        style={{
          zIndex: Z.info,
          lineHeight: 0,
          background: COLORS.holoBg03,
          border: `1px solid ${COLORS.holoBorder06}`,
          // Prominent while hidden (so it's findable to restore the HUD), quiet
          // while the HUD is shown.
          color: hudHidden ? COLORS.holoBright : COLORS.textMuted,
        }}
      >
        {hudHidden ? <HudHiddenIcon /> : <HudVisibleIcon />}
      </button>
    </div>
    </OpenFileProvider>
  )
}

// ─── HUD visibility icons (OTTO PATCH) ───────────────────────────────────────

function HudVisibleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function HudHiddenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}
