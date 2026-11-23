import { useEffect, useSyncExternalStore } from "react";
import type { BrainUiBridge, BrainUiSnapshot } from "./bridge";
import { useBrainSurfaceActive } from "./lifecycle";

function subscribeInactive(): () => void {
  return () => {};
}

/** Transport, reconnect, cursors and buffering remain the owning host adapter's work. */
export function useBrainUiSnapshot(bridge: BrainUiBridge): BrainUiSnapshot {
  const active = useBrainSurfaceActive();
  useEffect(() => {
    if (active) return bridge.retainStatus();
  }, [active, bridge]);
  return useSyncExternalStore(
    active ? bridge.subscribe : subscribeInactive,
    bridge.getSnapshot,
    bridge.getSnapshot,
  );
}
