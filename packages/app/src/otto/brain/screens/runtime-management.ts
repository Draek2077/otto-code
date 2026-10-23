export type BrainRuntimePhase = "running" | "starting" | "stopped" | "failed";

export interface BrainRuntimeIdentity {
  label: string;
  displayName: string;
  version: string;
}

/**
 * The runtime string in BrainHostStatus is resolved by the machine running
 * Brain. Keep the sentinel used by older hosts out of the installed state.
 */
export function resolveBrainHostRuntime(runtime: string | null | undefined): string | null {
  const value = runtime?.trim();
  return value && value.toLowerCase() !== "not installed" ? value : null;
}

/**
 * The resident Brain reports its runtime as `${label} v${version}`. That value
 * belongs to the host, so a remote manager must not infer it from the daemon
 * that happens to proxy the host.
 */
export function resolveHostSelectedBrainRuntime<T extends BrainRuntimeIdentity>(
  runtimes: T[],
  hostRuntime: string | null | undefined,
): T | null {
  const identity = hostRuntime?.trim();
  if (!identity) return null;
  return (
    runtimes.find((runtime) => {
      const managedLabel = runtime.displayName.replace(/ · [^·]+ \(Otto managed\)$/u, " (managed)");
      return (
        identity === `${runtime.label} v${runtime.version}` ||
        identity === `${managedLabel} v${runtime.version}` ||
        identity === runtime.displayName ||
        identity === runtime.label
      );
    }) ?? null
  );
}

/**
 * Compact label for the Overview hero: "CUDA 12.4 (b10534)". Returns null when
 * the displayName is not the managed pattern, so callers can fall back to the
 * full label.
 */
export function formatBrainRuntimeShortLabel(runtime: BrainRuntimeIdentity): string | null {
  const match = /^(.+) · (\S+) \(Otto managed\)$/u.exec(runtime.displayName);
  return match ? `${match[1]} (${match[2]})` : null;
}

export function isBrainRuntimeManagementAvailable({
  managementAllowed,
  hostConnected,
  brainStatusKnown,
  brainStatusError,
  brainPhase,
  runtimeListAnswered,
  runtimeListError,
}: {
  /** The selected Brain host, not the connecting daemon, permits writes. */
  managementAllowed: boolean;
  hostConnected: boolean;
  brainStatusKnown: boolean;
  brainStatusError: boolean;
  brainPhase: BrainRuntimePhase;
  runtimeListAnswered: boolean;
  runtimeListError: boolean;
}): boolean {
  return (
    managementAllowed &&
    hostConnected &&
    brainStatusKnown &&
    !brainStatusError &&
    brainPhase !== "failed" &&
    runtimeListAnswered &&
    !runtimeListError
  );
}
