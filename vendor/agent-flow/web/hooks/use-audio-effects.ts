import { useRef, useState, useEffect, useCallback } from 'react'
import { SOUND_PREF_KEY } from '@/lib/canvas-constants'
import { AudioEngine } from '@/lib/audio-engine'
import type { Agent, ToolCallNode } from '@/lib/agent-types'
import { detectStateChanges } from '@/components/agent-visualizer/canvas/detect-state-changes'

export function useAudioEffects(
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  isReviewing: boolean,
  // OTTO PATCH (OTTO-PATCHES.md): host-controlled master volume (0..1), or
  // null when the host hasn't sent one. Authoritative when present — a value
  // of 0 means muted, > 0 means audible at that level.
  hostVolume: number | null = null,
  // OTTO PATCH: notified whenever the user flips the in-page mute toggle, so the
  // host can persist the preference (localStorage resets every run on Otto's
  // fresh webview partition, so it can't be the durable store).
  onMuteChange: ((muted: boolean) => void) | null = null,
) {
  const audioRef = useRef<AudioEngine | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const seekingRef = useRef(false)
  const prevToolStatesRef = useRef<Map<string, string>>(new Map())
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map())

  // Audio engine lifecycle + restore persisted mute preference
  useEffect(() => {
    const engine = new AudioEngine()
    try {
      const savedOn = localStorage.getItem(SOUND_PREF_KEY) === 'on'
      if (savedOn) {
        engine.setMuted(false)
        setIsMuted(false)
      }
    } catch { /* localStorage unavailable (private browsing, etc.) */ }
    audioRef.current = engine
    return () => { audioRef.current?.dispose(); audioRef.current = null }
  }, [])

  // OTTO PATCH: apply the host-seeded master volume. Drives the engine AND the
  // mute state so the in-page mute toggle's icon reflects reality (volume 0 =
  // muted). The engine stores the level even before its AudioContext exists,
  // so a volume set before the first sound still takes effect.
  useEffect(() => {
    if (hostVolume == null || !audioRef.current) return
    const engine = audioRef.current
    engine.setVolume(hostVolume)
    const shouldMute = hostVolume <= 0
    engine.setMuted(shouldMute)
    setIsMuted(shouldMute)
  }, [hostVolume])

  // Detect tool/agent state transitions and play sounds (live mode only)
  useEffect(() => {
    if (seekingRef.current || !audioRef.current || isReviewing) return
    const audio = audioRef.current

    const { transitions, newAgentStates, newToolStates } = detectStateChanges(
      agents, toolCalls,
      prevAgentStatesRef.current, prevToolStatesRef.current,
    )
    prevAgentStatesRef.current = newAgentStates
    prevToolStatesRef.current = newToolStates

    for (const t of transitions) {
      switch (t.kind) {
        case 'agent_spawn':   audio.playAgentSpawn(); break
        case 'agent_complete': audio.playAgentComplete(); break
        case 'tool_start':    audio.playToolStart(); break
        case 'tool_complete': audio.playToolEnd(); break
        case 'tool_error':    audio.playError(); break
      }
    }
  }, [agents, toolCalls, isReviewing])

  const handleToggleMute = useCallback(() => {
    if (audioRef.current) {
      const nowMuted = audioRef.current.toggleMute()
      setIsMuted(nowMuted)
      try { localStorage.setItem(SOUND_PREF_KEY, nowMuted ? 'off' : 'on') } catch { /* ignore */ }
      // OTTO PATCH: let the host persist the preference (localStorage is ephemeral here).
      onMuteChange?.(nowMuted)
    }
  }, [onMuteChange])

  return { isMuted, seekingRef, handleToggleMute }
}
