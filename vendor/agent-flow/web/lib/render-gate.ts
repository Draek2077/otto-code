// OTTO PATCH (OTTO-PATCHES.md): render gate. Every requestAnimationFrame loop in
// the page stops while the host reports the surface off screen (config.paused)
// or the document itself is hidden, and restarts on resume. Chromium's own
// throttling of hidden frames is not relied on: whether a hidden guest keeps
// ticking depends on how the host hid it.

let hostPaused = false
const resumeListeners = new Set<() => void>()

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function isRenderPaused(): boolean {
  return hostPaused || documentHidden()
}

function notifyIfResumed(): void {
  if (isRenderPaused()) return
  for (const listener of resumeListeners) listener()
}

export function setHostRenderPaused(paused: boolean): void {
  if (hostPaused === paused) return
  hostPaused = paused
  notifyIfResumed()
}

/** Called each time rendering becomes allowed again. */
export function onRenderResume(listener: () => void): () => void {
  resumeListeners.add(listener)
  return () => { resumeListeners.delete(listener) }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', notifyIfResumed)
}
