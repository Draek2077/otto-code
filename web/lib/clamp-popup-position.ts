import { CARD } from '@/lib/agent-types'

/** Fallback viewport dimensions for SSR / non-browser environments */
const SSR_VIEWPORT_W = 800
const SSR_VIEWPORT_H = 600

/**
 * Clamp a popup position so it stays within the viewport.
 */
export function clampPopupPosition(
  position: { x: number; y: number },
  popupWidth: number,
  popupHeight: number,
  offsetY = 20,
): { left: number; top: number } {
  const maxX = typeof window !== 'undefined' ? window.innerWidth - popupWidth - CARD.margin : SSR_VIEWPORT_W
  const maxY = typeof window !== 'undefined' ? window.innerHeight - popupHeight - CARD.margin : SSR_VIEWPORT_H

  return {
    left: Math.min(Math.max(CARD.margin, position.x - popupWidth / 2), maxX),
    top: Math.min(Math.max(CARD.margin, position.y + offsetY), maxY),
  }
}
