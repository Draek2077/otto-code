import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { BrainSettingsPort, BrainSettingsSnapshot } from "./contracts";
import { openBrainSettingsForm } from "./form-model";

/** Mechanical lifecycle/data adapter; live snapshots never reconstruct the draft. */
export function useBrainSettingsForm(
  port: BrainSettingsPort,
  snapshot: BrainSettingsSnapshot,
  active: boolean,
) {
  const [model] = useState(() => openBrainSettingsForm(port));
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useEffect(() => model.applySnapshot(snapshot), [model, snapshot]);
  // Invalidate the reveal/read/write authority before a hidden frame can paint.
  useLayoutEffect(() => {
    if (active) return model.activate();
  }, [active, model]);
  useEffect(() => () => model.close(), [model]);
  return { model, state };
}
