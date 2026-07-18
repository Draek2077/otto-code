import { useEffect } from "react";
import { FEATURE_CATALOG, FEATURE_IDS, type FeatureId } from "@/features/feature-catalog";
import { resolveFeatureEnabled } from "@/features/use-feature-enabled";
import { useSettings } from "@/hooks/use-settings";
import {
  collectAllTabs,
  normalizeLayout,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

// Live UI removal: when a feature is turned off, close any open tabs it owns
// across every workspace, so a disabled feature vanishes without an app restart
// (the "nice to have" beyond the code-level unload, which the React.lazy gate
// already handles). Mount once, high in the workspace tree. The disabled-set is
// summarized into a stable string key so the effect only fires when the set of
// disabled features actually changes, not on every unrelated settings write.
export function useCloseDisabledFeatureTabs(): void {
  const disabledKey = useSettings((settings) =>
    FEATURE_IDS.filter((id) => !resolveFeatureEnabled(settings, id)).join(","),
  );

  useEffect(() => {
    if (!disabledKey) {
      return;
    }
    const disabledKinds = new Set(
      disabledKey.split(",").flatMap((id) => FEATURE_CATALOG[id as FeatureId].panelKinds),
    );
    const store = useWorkspaceLayoutStore.getState();
    for (const [workspaceKey, layout] of Object.entries(store.layoutByWorkspace)) {
      const tabs = collectAllTabs(normalizeLayout(layout).root);
      for (const tab of tabs) {
        if (disabledKinds.has(tab.target.kind)) {
          store.closeTab(workspaceKey, tab.tabId);
        }
      }
    }
  }, [disabledKey]);
}
