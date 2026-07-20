import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getIsAppInForeground } from "@/utils/app-visibility";
import { isWeb } from "@/constants/platform";

type AppStateSubscription = ReturnType<typeof AppState.addEventListener>;

let current = getIsAppInForeground();
const listeners = new Set<() => void>();
let appStateSubscription: AppStateSubscription | null = null;

function notify(): void {
  const next = getIsAppInForeground();
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Platform listeners are owned by the store, not by each consumer: when several
 * panes mounted their own, one unmounting called `removeEventListener` with the
 * shared `notify` reference and tore the listeners down for everyone still
 * mounted — leaving `current` frozen at whatever it last saw.
 */
function startListening(): void {
  appStateSubscription = AppState.addEventListener("change", notify);
  if (isWeb && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", notify);
    window.addEventListener("focus", notify);
    window.addEventListener("blur", notify);
  }
}

function stopListening(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  if (isWeb && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("blur", notify);
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    startListening();
  }
  listeners.add(listener);
  // `current` only advances while something is subscribed, so a visibility
  // change that happened with no consumers mounted left it stale — and a
  // consumer that mounts onto a stale `false` waits for an event that already
  // fired. Re-read on every subscribe so mounting is its own sync point.
  notify();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening();
    }
  };
}

function getSnapshot(): boolean {
  return current;
}

export function useAppVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
