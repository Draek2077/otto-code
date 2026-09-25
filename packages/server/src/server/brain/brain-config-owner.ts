import equal from "fast-deep-equal";

import type { DaemonConfigStore, MutableDaemonConfig } from "../daemon-config-store.js";
import type { BrainManager } from "./brain-manager.js";

/** Apply committed Brain settings in order, including edits made after startup. */
export function attachBrainConfigOwner(options: {
  store: DaemonConfigStore;
  manager: Pick<BrainManager, "applySettings">;
  onError: (error: unknown) => void;
}): () => void {
  let lastBrain = options.store.get().brain;
  let disposed = false;
  let pending = Promise.resolve();
  const apply = (brain: MutableDaemonConfig["brain"]) => {
    pending = pending
      .then(() => (disposed ? undefined : options.manager.applySettings(brain)))
      .catch(options.onError);
  };
  const unsubscribe = options.store.onChange((config) => {
    if (equal(config.brain, lastBrain)) return;
    lastBrain = config.brain;
    apply(config.brain);
  });
  apply(lastBrain);
  return () => {
    disposed = true;
    unsubscribe();
  };
}
