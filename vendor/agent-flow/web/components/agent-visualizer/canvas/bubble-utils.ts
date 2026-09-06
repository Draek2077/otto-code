import { BUBBLE_FADE_IN, BUBBLE_HOLD, BUBBLE_FADE_OUT } from '@/lib/canvas-constants'

/**
 * Compute the effective alpha for a message bubble given its age,
 * agent opacity, and whether it is a thinking bubble.
 *
 * Returns 0 when the bubble should be skipped entirely.
 */
export function bubbleAlpha(age: number, agentOpacity: number, persistent = false): number {
  // The focused chat background uses the canvas's own bubble system for exactly
  // one current assistant reply. It stays until the next assistant message
  // replaces it, rather than aging out with the transient event bubbles.
  if (persistent) return agentOpacity * 0.9
  if (age > BUBBLE_HOLD + BUBBLE_FADE_OUT) return 0

  let alpha: number
  if (age < BUBBLE_FADE_IN) {
    alpha = age / BUBBLE_FADE_IN
  } else if (age < BUBBLE_HOLD) {
    alpha = 1
  } else {
    alpha = 1 - (age - BUBBLE_HOLD) / BUBBLE_FADE_OUT
  }

  alpha = Math.max(0, Math.min(1, alpha)) * agentOpacity * 0.9
  return alpha
}
