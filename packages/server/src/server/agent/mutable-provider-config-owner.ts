import equal from "fast-deep-equal";

import type { DaemonConfigStore } from "../daemon-config-store.js";
import type {
  AgentManagerProviderState,
  ProviderSnapshotManager,
} from "./provider-snapshot-manager.js";

export function attachMutableProviderConfigOwner(options: {
  store: DaemonConfigStore;
  providerSnapshotManager: ProviderSnapshotManager;
  updateProviderRegistry: (state: AgentManagerProviderState) => void;
}): () => void {
  let commitPendingProviderChange: (() => void) | null = null;
  let appliedModelTierOverrides = options.store.get().modelTierOverrides;
  let appliedModelVisibilityOverrides = options.store.get().modelVisibilityOverrides;

  const unsubscribeApply = options.store.onApply((config, previous, details) => {
    if (equal(config.providers, previous.providers)) return () => undefined;

    const previousAgentManagerState =
      options.providerSnapshotManager.getAgentManagerProviderState();
    // Preparation leaves published catalogs and in-flight discovery untouched.
    // The config store commits only after every live owner's apply succeeds.
    const prepared = options.providerSnapshotManager.prepareMutableProviderConfig(
      config.providers,
      {
        removeProviders: details.removedProviders,
        replace: true,
      },
    );
    try {
      options.updateProviderRegistry(prepared.agentManagerState);
    } catch (error) {
      try {
        options.updateProviderRegistry(previousAgentManagerState);
      } catch (rollbackError) {
        const failure = new AggregateError(
          [error, rollbackError],
          "Provider config apply failed and the previous agent registry could not be restored",
          { cause: error },
        );
        throw failure;
      }
      throw error;
    }
    commitPendingProviderChange = prepared.commit;

    return () => {
      commitPendingProviderChange = null;
      options.updateProviderRegistry(previousAgentManagerState);
    };
  });
  const unsubscribeChange = options.store.onChange((config) => {
    const commit = commitPendingProviderChange;
    commitPendingProviderChange = null;
    commit?.();
    // Catalog metadata is derived from the saved overrides. Restamp only after
    // the config transaction commits so rejected patches cannot leak into clients.
    if (!equal(config.modelTierOverrides, appliedModelTierOverrides)) {
      appliedModelTierOverrides = config.modelTierOverrides;
      options.providerSnapshotManager.setModelTierOverrides(config.modelTierOverrides);
    }
    if (!equal(config.modelVisibilityOverrides, appliedModelVisibilityOverrides)) {
      appliedModelVisibilityOverrides = config.modelVisibilityOverrides;
      options.providerSnapshotManager.setModelVisibilityOverrides(config.modelVisibilityOverrides);
    }
  });

  return () => {
    commitPendingProviderChange = null;
    unsubscribeApply();
    unsubscribeChange();
  };
}
