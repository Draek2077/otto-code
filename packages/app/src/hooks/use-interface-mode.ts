import { queryClient } from "@/data/query-client";
import { useSettings, type AppSettings, type InterfaceMode } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

// The single gate for User vs Developer interface depth. Interface mode is
// presentation only — it changes what the client renders, never what the daemon
// does, what agents can do, or what rides the wire (see
// projects/first-time-wizard/interface-modes.md). Every consumer of these hooks
// must map to a row in the surface inventory; a stray import elsewhere is a defect.
//
// Resolution rule: a `null` stored value (unchosen / legacy device) resolves to
// "developer" so existing and undecided devices behave exactly like today's app.
// Nobody wakes up in User mode.
function resolveInterfaceMode(stored: InterfaceMode | null | undefined): InterfaceMode {
  return stored ?? "developer";
}

/** Reactive: the effective interface mode, `null` resolved to "developer". */
export function useInterfaceMode(): InterfaceMode {
  return useSettings((settings) => resolveInterfaceMode(settings.interfaceMode));
}

/** Reactive: the boolean form 90% of gate sites want. */
export function useIsDeveloperMode(): boolean {
  return useInterfaceMode() === "developer";
}

/**
 * Imperative, non-React read of the same settings query cache — for gate sites
 * that run outside the React tree (keyboard-action dispatch, file-open paths).
 * Reads the single source of truth (no second store); falls back to "developer"
 * when the cache is not yet populated, matching the resolution rule above.
 */
export function getInterfaceModeSnapshot(): InterfaceMode {
  const settings = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return resolveInterfaceMode(settings?.interfaceMode);
}

/** Imperative counterpart to {@link useIsDeveloperMode}. */
export function getIsDeveloperModeSnapshot(): boolean {
  return getInterfaceModeSnapshot() === "developer";
}
