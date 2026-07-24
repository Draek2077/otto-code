import { useSyncExternalStore } from "react";

// Which message is currently speaking — a sibling registry to
// assistant-bubble-text.ts, and for the same structural reason: the state lives
// in the playback button, but the component that must react to it is an
// ancestor (the bubble that owns the button's visibility).
//
// The button is hover-revealed, which is right for a Play affordance and wrong
// for a Stop one: once playback started, moving the pointer away made the only
// way to stop it both invisible and unclickable. A speaking message therefore
// forces its own button visible, and only its own — hence a key rather than a
// global boolean, which would reveal every button in the chat.
//
// Exactly one message can be speaking at a time by construction: starting
// playback flushes the audio queue and aborts any in-flight synthesis, so a
// second one starting simply replaces the first.

let activeTurnKey: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeMessagePlaybackActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mark this turn as the one currently speaking. */
export function setMessagePlaybackActive(turnKey: string): void {
  if (activeTurnKey === turnKey) {
    return;
  }
  activeTurnKey = turnKey;
  emit();
}

/**
 * Clear the speaking turn — but only if it is still this one. A turn whose
 * playback was superseded by another must not clear the newcomer's claim when
 * its own request finally unwinds.
 */
export function clearMessagePlaybackActive(turnKey: string): void {
  if (activeTurnKey !== turnKey) {
    return;
  }
  activeTurnKey = null;
  emit();
}

/** The turn currently speaking, or null. */
export function getActiveMessagePlaybackTurnKey(): string | null {
  return activeTurnKey;
}

/** True while this turn is the one speaking. Always false without a key. */
export function useIsMessagePlaybackActive(turnKey: string | undefined): boolean {
  const active = useSyncExternalStore(
    subscribeMessagePlaybackActivity,
    getActiveMessagePlaybackTurnKey,
    getActiveMessagePlaybackTurnKey,
  );
  return turnKey !== undefined && active === turnKey;
}

/** Test seam — drops any active claim. */
export function resetMessagePlaybackActivity(): void {
  activeTurnKey = null;
  emit();
}
