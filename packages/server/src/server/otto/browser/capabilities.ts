/** Advertise only the registered daemon-owned browser service. */
export function ottoBrowserCapabilities(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  return { ottoBrowserHistory: runtime?.supportsBuiltinRpc?.("otto-browser") === true };
}
