/** Advertise only the registered daemon-owned browser service. */
export function ottoBrowserCapabilities(
  runtime: { supportsBuiltinRpc?(id: string): boolean } | undefined,
) {
  const available = runtime?.supportsBuiltinRpc?.("otto-browser") === true;
  return { ottoBrowserHistory: available, ottoPreview: available, ottoHostBrowser: available };
}
