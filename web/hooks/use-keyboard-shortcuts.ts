import { useEffect, useRef } from "react"

export function useKeyboardShortcuts(actions: {
  togglePlayPause: () => void
  toggleFilePanel: () => void
  toggleTranscript: () => void
  toggleTimeline: () => void
  toggleHexGrid: () => void
  toggleStats: () => void
  toggleCostOverlay: () => void
  zoomToFit: () => void
  clearSelection: () => void
  deselectAgent: () => void
  closeTranscript: () => void
  toggleMute: () => void
  setSpeed: (speed: number) => void
  selectedAgentId: string | null
}): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const a = actionsRef.current

      switch (e.key) {
        case ' ':
          e.preventDefault()
          a.togglePlayPause()
          break
        case 'f':
          a.toggleFilePanel()
          break
        case 'F':
          a.zoomToFit()
          break
        case 't':
        case 'T':
          a.toggleTimeline()
          break
        case 'Delete':
        case 'Backspace':
          if (a.selectedAgentId) {
            a.deselectAgent()
          }
          break
        case 'Escape':
          a.clearSelection()
          a.closeTranscript()
          break
        case 'c':
        case 'C':
          a.toggleTranscript()
          break
        case 'g':
        case 'G':
          a.toggleHexGrid()
          break
        case 's':
        case 'S':
          a.toggleStats()
          break
        case '$':
          a.toggleCostOverlay()
          break
        case 'm':
        case 'M':
          a.toggleMute()
          break
        case '1': a.setSpeed(0.5); break
        case '2': a.setSpeed(1); break
        case '3': a.setSpeed(2); break
        case '4': a.setSpeed(4); break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
