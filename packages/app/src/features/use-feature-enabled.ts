import { queryClient } from "@/data/query-client";
import { FEATURE_CATALOG, type FeatureId } from "@/features/feature-catalog";
import { useSettings, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

// The single gate for whether an optional feature is enabled. Feature enablement
// is device-local presentation only — it changes what this client loads and
// renders, never the daemon, agents, or anything on the wire (mirrors
// use-interface-mode.ts). Resolution rule: a missing key ⇒ the feature's own
// `defaultEnabled` (all-on today), so existing devices behave exactly like
// before this setting existed.
function resolveFeatureEnabled(
  settings: Pick<AppSettings, "featureEnabled"> | undefined,
  id: FeatureId,
): boolean {
  const stored = settings?.featureEnabled?.[id];
  return stored ?? FEATURE_CATALOG[id].defaultEnabled;
}

export { resolveFeatureEnabled };

/** Reactive: whether the given feature is enabled on this device. */
export function useFeatureEnabled(id: FeatureId): boolean {
  return useSettings((settings) => resolveFeatureEnabled(settings, id));
}

/**
 * Imperative, non-React read of the same settings query cache — for gate sites
 * that run outside the React tree (e.g. openVisualizerTab, dispatched from a
 * button handler / keyboard action). Reads the single source of truth; falls
 * back to `defaultEnabled` when the cache is not yet populated.
 */
export function getFeatureEnabledSnapshot(id: FeatureId): boolean {
  const settings = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return resolveFeatureEnabled(settings, id);
}
