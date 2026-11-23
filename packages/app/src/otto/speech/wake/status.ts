import type { WakeWordState } from "./controller";
const listeners = new Set<() => void>();
let owner: symbol | null = null;
let snapshot: { state: WakeWordState; error: string } = { state: "disabled", error: "" };
export const getWakeStatus = () => snapshot;
export function subscribeWakeStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function ownWakeStatus() {
  const token = Symbol("wake-status");
  owner = token;
  const publish = (state: WakeWordState, error = "") => {
    if (owner !== token || (snapshot.state === state && snapshot.error === error)) return;
    snapshot = { state, error };
    for (const listener of listeners) listener();
  };
  return {
    publish,
    release() {
      if (owner !== token) return;
      publish("disabled");
      owner = null;
    },
  };
}
